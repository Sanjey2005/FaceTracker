"""
visitor_counter.py — Unique visitor statistics derived from PostgreSQL.

All reads borrow a connection from the Database pool via get_connection()
and return it immediately after the query.  No writes are ever issued
from this module.

Allowed imports: logging, pathlib + Database.
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from modules.database import Database

logger = logging.getLogger(__name__)


class VisitorCounter:
    """Provides visitor statistics by querying the face-tracker PostgreSQL database.

    Borrows connections from the shared pool on every query so reads never
    contend with the write-queue worker.  All methods are synchronous.
    """

    def __init__(self, db: Database) -> None:
        """Initialise VisitorCounter.

        Args:
            db: Initialised Database instance — used for get_connection().
        """
        self._db = db
        logger.info("VISITORCOUNTER_INIT")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_total_unique(self) -> int:
        """Return the total number of unique registered faces in the DB.

        Uses the ``faces`` table, which can never contain duplicates.
        """
        with self._db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM faces")
                row = cur.fetchone()
        return row[0]

    def get_today_unique(self) -> int:
        """Return the count of unique faces that generated an ENTRY today."""
        with self._db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(DISTINCT face_id)
                    FROM   events
                    WHERE  timestamp::date = CURRENT_DATE
                      AND  event_type = 'ENTRY'
                    """
                )
                row = cur.fetchone()
        return row[0]

    def get_currently_inside(self) -> int:
        """Return the number of faces currently inside (last event was ENTRY).

        Uses a window function to find the most recent event per face, then
        counts those whose most-recent event is an ENTRY.
        """
        with self._db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*)
                    FROM (
                        SELECT face_id,
                               event_type,
                               ROW_NUMBER() OVER (
                                   PARTITION BY face_id
                                   ORDER BY timestamp DESC
                               ) AS rn
                        FROM events
                    ) sub
                    WHERE rn = 1
                      AND event_type = 'ENTRY'
                    """
                )
                row = cur.fetchone()
        return row[0]

    def get_avg_dwell_seconds(self) -> float:
        """Return the average dwell time in seconds across all matched ENTRY/EXIT pairs."""
        with self._db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT AVG(
                        EXTRACT(EPOCH FROM (
                            ex.timestamp::timestamp - en.timestamp::timestamp
                        ))
                    )
                    FROM  events ex
                    JOIN  events en ON ex.face_id = en.face_id
                    WHERE ex.event_type = 'EXIT'
                      AND en.event_type = 'ENTRY'
                    """
                )
                row = cur.fetchone()
        result = row[0]
        return float(result) if result is not None else 0.0

    def log_count(self, frame_id: int) -> None:
        """Log current visitor statistics at INFO level."""
        total = self.get_total_unique()
        today = self.get_today_unique()
        inside = self.get_currently_inside()
        logger.info(
            "UNIQUE_VISITORS total=%d today=%d inside=%d frame=%d",
            total,
            today,
            inside,
            frame_id,
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """No-op — connections are managed by the Database pool."""
        logger.info("VISITORCOUNTER_CLOSED")


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import numpy as np

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(module)s | %(message)s",
    )

    from modules.config_loader import load_config

    cfg = load_config()
    db = Database(cfg)

    face_a = "vc_test_a"
    face_b = "vc_test_b"
    emb = np.random.rand(512).astype(np.float32)

    db.register_face(face_a, emb, "2026-03-20T10:00:00")
    db.register_face(face_b, emb, "2026-03-20T10:05:00")
    db.log_event(face_a, "ENTRY", "2026-03-20T10:00:01", "", frame_num=1)
    db.log_event(face_a, "EXIT",  "2026-03-20T10:30:00", "", frame_num=900)
    db.log_event(face_b, "ENTRY", "2026-03-20T10:05:00", "", frame_num=150)
    db.flush()

    vc = VisitorCounter(db)

    total      = vc.get_total_unique()
    today      = vc.get_today_unique()
    inside     = vc.get_currently_inside()
    avg_dwell  = vc.get_avg_dwell_seconds()

    print(f"Total unique:      {total}")
    print(f"Today unique:      {today}")
    print(f"Currently inside:  {inside}")
    print(f"Avg dwell (secs):  {avg_dwell:.1f}")

    assert total  >= 2, f"Expected >= 2, got {total}"
    assert inside == 1, f"Expected 1 inside (face_b), got {inside}"
    assert avg_dwell > 0, "Expected positive avg dwell"

    vc.log_count(frame_id=900)
    vc.close()

    # Clean up test rows
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM events WHERE face_id IN (%s, %s)", (face_a, face_b))
            cur.execute("DELETE FROM faces  WHERE face_id IN (%s, %s)", (face_a, face_b))

    db.close()
    print("visitor_counter.py self-test passed.")
