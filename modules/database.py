"""
database.py — PostgreSQL persistence layer for the face tracker.

All writes are dispatched through a background thread queue to keep the
inference loop non-blocking.  Reads use short-lived pool connections.

Allowed imports: psycopg2, threading, queue, numpy, logging, pathlib,
                 contextlib.
"""

import logging
import queue
import sys
import threading
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import psycopg2
import psycopg2.extras
import psycopg2.pool

from modules.config_loader import Config

logger = logging.getLogger(__name__)

_SENTINEL = object()  # signals the worker thread to stop


class Database:
    """PostgreSQL-backed persistence for faces, events, and system logs.

    All INSERT/UPDATE statements are enqueued and executed by a single
    background worker thread, ensuring the inference loop is never blocked
    by I/O.  Reads borrow a connection from the pool, execute, and return
    it immediately.

    A ThreadedConnectionPool (min=1, max=10) is shared across all threads.
    The worker holds one connection for its entire lifetime; all other
    callers borrow via get_connection().
    """

    def __init__(self, cfg: Config) -> None:
        """Initialise the pool, create schema, and start the write worker.

        Args:
            cfg: Loaded Config dataclass instance.
        """
        self._database_url = cfg.database_url
        self._pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=self._database_url,
        )
        self._queue: queue.Queue = queue.Queue()
        self._schema_ready = threading.Event()

        self._worker = threading.Thread(
            target=self._worker_loop, daemon=True, name="db-writer"
        )
        self._worker.start()

        # Block until the worker has created the schema.
        self._schema_ready.wait()

        host_db = self._database_url.split("@")[-1]
        logger.info("DATABASE_READY url=%s", host_db)

    # ------------------------------------------------------------------
    # Public context manager — borrow / return a pool connection
    # ------------------------------------------------------------------

    @contextmanager
    def get_connection(self):
        """Borrow a connection from the pool; commit on success, rollback on error."""
        conn = self._pool.getconn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self._pool.putconn(conn)

    # ------------------------------------------------------------------
    # Internal worker
    # ------------------------------------------------------------------

    def _worker_loop(self) -> None:
        """Background thread: owns one pool connection for its entire lifetime."""
        conn = self._pool.getconn()
        try:
            self._init_db(conn)
            self._schema_ready.set()

            while True:
                item = self._queue.get()

                if item is _SENTINEL:
                    self._queue.task_done()
                    break

                sql, params = item
                try:
                    with conn.cursor() as cur:
                        cur.execute(sql, params)
                    conn.commit()
                except psycopg2.Error as exc:
                    logger.error("DB_WRITE_ERROR sql=%r error=%s", sql, exc)
                    conn.rollback()
                self._queue.task_done()

        finally:
            self._pool.putconn(conn)

    def _enqueue(self, sql: str, params: tuple = ()) -> None:
        """Push a write operation onto the queue."""
        self._queue.put((sql, params))

    # ------------------------------------------------------------------
    # Schema initialisation (runs inside worker thread on startup)
    # ------------------------------------------------------------------

    def _init_db(self, conn) -> None:
        """Create tables if they don't exist. Runs once from the worker thread.

        Raises psycopg2.errors.InsufficientPrivilege if faceuser lacks CREATE
        on the public schema.  Fix with (as postgres superuser):
            GRANT ALL ON SCHEMA public TO faceuser;
        """
        try:
            return self._create_tables(conn)
        except psycopg2.errors.InsufficientPrivilege:
            logger.error(
                "DB_SCHEMA_ERROR: faceuser lacks CREATE ON SCHEMA public. "
                "Fix with: GRANT ALL ON SCHEMA public TO faceuser;"
            )
            raise

    def _create_tables(self, conn) -> None:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS faces (
                    face_id          TEXT PRIMARY KEY,
                    first_seen       TEXT NOT NULL,
                    last_seen        TEXT NOT NULL,
                    visit_count      INTEGER DEFAULT 1,
                    embedding        BYTEA NOT NULL,
                    thumbnail        TEXT,
                    estimated_age    INTEGER,
                    estimated_gender TEXT,
                    photo_b64        TEXT
                )
            """)
            cur.execute("""
                ALTER TABLE faces ADD COLUMN IF NOT EXISTS photo_b64 TEXT
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    event_id    BIGSERIAL PRIMARY KEY,
                    face_id     TEXT NOT NULL,
                    event_type  TEXT NOT NULL,
                    timestamp   TEXT NOT NULL,
                    image_path  TEXT NOT NULL,
                    frame_num   INTEGER,
                    confidence  DOUBLE PRECISION,
                    camera_id   TEXT DEFAULT 'cam_01'
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS system_logs (
                    log_id    BIGSERIAL PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    level     TEXT,
                    module    TEXT,
                    message   TEXT
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watchlist (
                    id        SERIAL PRIMARY KEY,
                    name      TEXT NOT NULL,
                    embedding BYTEA NOT NULL,
                    photo_b64 TEXT,
                    added_at  TIMESTAMP DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                    id             SERIAL PRIMARY KEY,
                    watchlist_id   INTEGER REFERENCES watchlist(id) ON DELETE CASCADE,
                    watchlist_name TEXT,
                    face_id        TEXT,
                    camera_id      TEXT,
                    snapshot_b64   TEXT,
                    matched_at     TIMESTAMP DEFAULT NOW(),
                    similarity     FLOAT,
                    acknowledged   BOOLEAN DEFAULT FALSE
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watchlist_embeddings (
                    id           SERIAL PRIMARY KEY,
                    watchlist_id INTEGER REFERENCES watchlist(id) ON DELETE CASCADE,
                    embedding    BYTEA NOT NULL,
                    added_at     TIMESTAMP DEFAULT NOW()
                )
            """)
            # Idempotent migration: seed watchlist_embeddings from existing watchlist rows
            cur.execute("""
                INSERT INTO watchlist_embeddings (watchlist_id, embedding, added_at)
                SELECT w.id, w.embedding, w.added_at
                FROM watchlist w
                WHERE w.id NOT IN (
                    SELECT DISTINCT watchlist_id FROM watchlist_embeddings
                )
            """)
        conn.commit()
        logger.info("DB_SCHEMA_READY")

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    def register_face(
        self,
        face_id: str,
        embedding: np.ndarray,
        timestamp: str,
        age: int | None = None,
        gender: str | None = None,
    ) -> None:
        """Register new face — SYNCHRONOUS write so face exists before events.

        Args:
            face_id: Short UUID string for this face.
            embedding: 512-dim float32 numpy array.
            timestamp: ISO-8601 timestamp string.
            age: Estimated age (optional).
            gender: Estimated gender string (optional).
        """
        blob = psycopg2.Binary(embedding.astype(np.float32).tobytes())
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO faces
                        (face_id, first_seen, last_seen, embedding,
                         estimated_age, estimated_gender)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (face_id, timestamp, timestamp, blob, age, gender),
                )
        logger.info("FACE_REGISTERED face_id=%s", face_id)

    def update_face_photo(self, face_id: str, photo_b64: str) -> None:
        """Store the face crop as base64 in faces.photo_b64 (async via write queue)."""
        self._enqueue(
            "UPDATE faces SET photo_b64=%s WHERE face_id=%s",
            (photo_b64, face_id),
        )

    def update_embedding(self, face_id: str, embedding: np.ndarray) -> None:
        """Update the stored embedding for an existing face (async via write queue).

        Args:
            face_id: The face UUID to update.
            embedding: New L2-normalised 512-dim float32 array.
        """
        blob = psycopg2.Binary(embedding.astype(np.float32).tobytes())
        self._enqueue(
            "UPDATE faces SET embedding=%s WHERE face_id=%s",
            (blob, face_id),
        )

    def update_face_demographics(
        self, face_id: str, age: int | None, gender: str | None
    ) -> None:
        """Update age and gender for a registered face."""
        self._enqueue(
            "UPDATE faces SET estimated_age=%s, estimated_gender=%s WHERE face_id=%s",
            (age, gender, face_id),
        )

    def update_face_last_seen(self, face_id: str, timestamp: str) -> None:
        """Increment visit_count and update last_seen for an existing face."""
        self._enqueue(
            "UPDATE faces SET last_seen=%s, visit_count=visit_count+1 WHERE face_id=%s",
            (timestamp, face_id),
        )

    def log_event(
        self,
        face_id: str,
        event_type: str,
        timestamp: str,
        image_path: str,
        frame_num: int | None = None,
        confidence: float | None = None,
        camera_id: str = "cam_01",
    ) -> None:
        """Insert a new event row (ENTRY, EXIT, etc.) via the write queue."""
        self._enqueue(
            """
            INSERT INTO events
                (face_id, event_type, timestamp, image_path,
                 frame_num, confidence, camera_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (face_id, event_type, timestamp, image_path,
             frame_num, confidence, camera_id),
        )

    # ------------------------------------------------------------------
    # Read operations (synchronous, borrow pool connection per call)
    # ------------------------------------------------------------------

    def load_all_embeddings(self) -> tuple[list[str], np.ndarray]:
        """Load every face embedding — used to rebuild FAISS on startup.

        Returns:
            (face_id_list, numpy_array_of_shape_(N, 512)).
        """
        with self.get_connection() as conn:
            with conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor
            ) as cur:
                cur.execute("SELECT face_id, embedding FROM faces")
                rows = cur.fetchall()

        if not rows:
            return [], np.empty((0, 512), dtype=np.float32)

        ids = [row["face_id"] for row in rows]
        # psycopg2 returns BYTEA as memoryview — wrap with bytes() first.
        embeddings = np.stack([
            np.frombuffer(bytes(row["embedding"]), dtype=np.float32)
            for row in rows
        ])
        logger.info("EMBEDDINGS_LOADED count=%d", len(ids))
        return ids, embeddings

    def get_unique_visitor_count(self) -> int:
        """Return the total number of unique registered faces."""
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM faces")
                row = cur.fetchone()
        return row[0]

    def get_hourly_stats(self) -> list[dict]:
        """Return per-hour unique visitor counts for ENTRY events.

        Returns:
            List of dicts with keys 'hour' (str 'HH') and 'visitors' (int).
        """
        with self.get_connection() as conn:
            with conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor
            ) as cur:
                cur.execute("""
                    SELECT TO_CHAR(timestamp::timestamp, 'HH24') AS hour,
                           COUNT(DISTINCT face_id)               AS visitors
                    FROM   events
                    WHERE  event_type = 'ENTRY'
                    GROUP  BY hour
                    ORDER  BY hour
                """)
                rows = cur.fetchall()
        return [dict(row) for row in rows]

    def get_recent_events(self, limit: int = 10) -> list[dict]:
        """Return the most recent events joined with face metadata.

        Args:
            limit: Maximum number of rows to return.
        """
        with self.get_connection() as conn:
            with conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor
            ) as cur:
                cur.execute(
                    """
                    SELECT e.event_id, e.face_id, e.event_type, e.timestamp,
                           e.image_path, e.frame_num, e.confidence, e.camera_id,
                           f.estimated_age, f.estimated_gender, f.visit_count
                    FROM   events e
                    JOIN   faces  f ON e.face_id = f.face_id
                    ORDER  BY e.timestamp DESC
                    LIMIT  %s
                    """,
                    (limit,),
                )
                rows = cur.fetchall()
        return [dict(row) for row in rows]

    def get_demographics(self) -> dict:
        """Return gender distribution across all registered faces."""
        with self.get_connection() as conn:
            with conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor
            ) as cur:
                cur.execute("""
                    SELECT estimated_gender, COUNT(*) AS cnt
                    FROM   faces
                    GROUP  BY estimated_gender
                """)
                rows = cur.fetchall()
        return {row["estimated_gender"]: row["cnt"] for row in rows}

    # ------------------------------------------------------------------
    # Connection test
    # ------------------------------------------------------------------

    def test_connection(self) -> bool:
        """Verify connectivity and log the result.

        Returns:
            True on success, False on failure.
        """
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            host_db = self._database_url.split("@")[-1]
            logger.info("DB_CONNECTION_TEST success url=%s", host_db)
            return True
        except Exception as exc:
            logger.error("DB_CONNECTION_TEST failed: %s", exc)
            return False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def flush(self) -> None:
        """Block until all queued write operations have been executed."""
        self._queue.join()

    def close(self) -> None:
        """Flush pending writes, stop the worker thread, and close the pool."""
        self.flush()
        self._queue.put(_SENTINEL)
        self._worker.join()
        self._pool.closeall()
        host_db = self._database_url.split("@")[-1]
        logger.info("DATABASE_CLOSED url=%s", host_db)


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(module)s | %(message)s",
    )

    from modules.config_loader import load_config

    cfg = load_config()
    db = Database(cfg)

    db.test_connection()

    test_id = "test_abc1"
    test_emb = np.random.rand(512).astype(np.float32)

    db.register_face(test_id, test_emb, "2026-03-20T19:00:00", age=25, gender="Male")
    db.log_event(test_id, "ENTRY", "2026-03-20T19:00:01", "logs/entries/test.jpg", frame_num=1)
    db.flush()

    print("Unique visitors:", db.get_unique_visitor_count())

    ids, embs = db.load_all_embeddings()
    print("Loaded embeddings shape:", embs.shape)
    print("Face IDs:", ids)

    # Clean up test row
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM events WHERE face_id=%s", (test_id,))
            cur.execute("DELETE FROM faces  WHERE face_id=%s", (test_id,))

    db.close()
    print("database.py self-test passed.")
