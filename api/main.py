"""
api/main.py — FastAPI backend for the FaceTracker dashboard.

Endpoints:
  GET  /stats              — KPI summary (total, today, inside, avg dwell)
  GET  /events             — Last 20 events ordered by timestamp DESC
  GET  /hourly             — Visitor count per hour (from faces.first_seen)
  GET  /demographics       — Male / Female split from faces table
  POST /stream/start       — Start background pipeline thread (camera_id optional, default cam_01)
  POST /stream/stop        — Stop background pipeline thread
  POST /stream/upload      — Upload a video file, returns saved path
  GET  /stream/feed        — MJPEG stream (?camera_id=cam_01)
  POST /search/set-target  — Upload a photo, extract embedding, find match in DB
  GET  /search/status      — Current search target state
  POST /search/clear       — Clear search target

Run with:
  uvicorn api.main:app --reload --port 8000
"""

import asyncio
import base64
import logging
import queue
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import psycopg2
import psycopg2.extras
import psycopg2.pool
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATABASE_URL = "postgresql://faceuser:facepass@localhost:5432/facetracker"
_CONFIG_PATH = Path(__file__).parent.parent / "config.json"

logger = logging.getLogger("api")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(module)s | %(message)s",
)

# ---------------------------------------------------------------------------
# Connection pool (shared across all requests)
# ---------------------------------------------------------------------------

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pool
    _pool = psycopg2.pool.ThreadedConnectionPool(1, 10, dsn=DATABASE_URL)
    logger.info("API_DB_POOL_READY")
    _ensure_watchlist_schema()
    yield
    if _pool:
        _pool.closeall()
    logger.info("API_DB_POOL_CLOSED")


def get_conn():
    """Borrow a connection; caller must call _pool.putconn(conn) in finally."""
    if _pool is None:
        raise HTTPException(status_code=503, detail="Database pool not initialised")
    return _pool.getconn()


# ---------------------------------------------------------------------------
# Multi-camera streaming state
# ---------------------------------------------------------------------------

# { cam_id: { 'queue': Queue, 'thread': Thread, 'stop': Event } }
_cameras: dict = {}

# { cam_id: set of face_ids currently visible in that camera }
_camera_last_resolved: dict = {}

# ---------------------------------------------------------------------------
# Person search state
# ---------------------------------------------------------------------------

_target_embeddings: list = []  # list of L2-normalised numpy arrays, one per enrolled photo
_target_face_id: Optional[str] = None
_search_embedder = None  # lazy-loaded FaceEmbedder

# ---------------------------------------------------------------------------
# Watchlist state
# ---------------------------------------------------------------------------

# In-memory cache: [{id, name, embedding_norm}] — refreshed every 30s by pipeline
_watchlist_cache: list = []
_watchlist_cache_ts: float = 0.0
_WATCHLIST_REFRESH_SECS = 30

# Duplicate alert suppression: {(camera_id, watchlist_id): monotonic_time}
_recent_alert_ts: dict = {}
_ALERT_COOLDOWN_SECS = 60


def _get_search_embedder():
    """Lazy-load FaceEmbedder once; avoids reloading 300MB buffalo_l model per request."""
    global _search_embedder
    if _search_embedder is None:
        from modules.config_loader import load_config
        from modules.face_embedder import FaceEmbedder
        _search_embedder = FaceEmbedder(load_config(str(_CONFIG_PATH)))
    return _search_embedder


# ---------------------------------------------------------------------------
# Watchlist helpers
# ---------------------------------------------------------------------------


def _ensure_watchlist_schema() -> None:
    """Create watchlist + alerts tables if they don't exist. Called from lifespan."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
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
                CREATE TABLE IF NOT EXISTS watchlist_embeddings (
                    id           SERIAL PRIMARY KEY,
                    watchlist_id INTEGER NOT NULL REFERENCES watchlist(id) ON DELETE CASCADE,
                    embedding    BYTEA NOT NULL,
                    added_at     TIMESTAMP DEFAULT NOW()
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
        conn.commit()
        logger.info("WATCHLIST_SCHEMA_READY")
    finally:
        _pool.putconn(conn)


def _refresh_watchlist_cache() -> None:
    """Load all watchlist embeddings (L2-normalised) into _watchlist_cache.

    Groups multiple embeddings per watchlist person so _check_watchlist can
    compare against all enrolled photos.
    """
    global _watchlist_cache, _watchlist_cache_ts
    if not _pool:
        return
    conn = _pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT w.id, w.name, we.embedding
                FROM watchlist w
                JOIN watchlist_embeddings we ON we.watchlist_id = w.id
                ORDER BY w.id
            """)
            rows = cur.fetchall()
    finally:
        _pool.putconn(conn)

    # Group embeddings by watchlist person id
    grouped: dict = {}
    for row in rows:
        wl_id = row["id"]
        if wl_id not in grouped:
            grouped[wl_id] = {"id": wl_id, "name": row["name"], "embeddings_norm": []}
        emb = np.frombuffer(bytes(row["embedding"]), dtype=np.float32)
        norm = emb / (np.linalg.norm(emb) + 1e-8)
        grouped[wl_id]["embeddings_norm"].append(norm)

    _watchlist_cache = list(grouped.values())
    _watchlist_cache_ts = time.monotonic()
    logger.info("WATCHLIST_CACHE_REFRESHED entries=%d", len(_watchlist_cache))


def _check_watchlist(
    camera_id: str,
    face_id: str,
    raw_embedding: np.ndarray,
    frame: np.ndarray,
    bbox: tuple,
) -> None:
    """Check a resolved face embedding against the watchlist. Insert alert if matched.

    Called from _run_pipeline() after every re-ID resolution.
    Uses _recent_alert_ts to suppress duplicate alerts within 60 seconds.
    """
    global _watchlist_cache_ts, _recent_alert_ts

    # Refresh stale cache
    if time.monotonic() - _watchlist_cache_ts > _WATCHLIST_REFRESH_SECS:
        _refresh_watchlist_cache()

    if not _watchlist_cache:
        return

    emb_norm = raw_embedding / (np.linalg.norm(raw_embedding) + 1e-8)
    now = time.monotonic()

    for entry in _watchlist_cache:
        # Compare against all enrolled embeddings; take best match
        best_sim = max(
            float(np.dot(emb_norm, ref)) for ref in entry["embeddings_norm"]
        )
        if best_sim < 0.55:
            continue

        wl_id = entry["id"]
        key = (camera_id, wl_id)

        # Suppress duplicate alerts within cooldown window
        if now - _recent_alert_ts.get(key, 0.0) < _ALERT_COOLDOWN_SECS:
            continue

        _recent_alert_ts[key] = now

        # Capture 200×200 snapshot as base64 JPEG
        x1, y1, x2, y2 = map(int, bbox)
        crop = frame[max(y1, 0):max(y2, 0), max(x1, 0):max(x2, 0)]
        snapshot_b64 = None
        if crop.size > 0:
            crop_resized = cv2.resize(crop, (200, 200))
            _, buf = cv2.imencode(".jpg", crop_resized, [cv2.IMWRITE_JPEG_QUALITY, 75])
            snapshot_b64 = base64.b64encode(buf.tobytes()).decode()

        # Insert alert row
        if _pool:
            conn = _pool.getconn()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO alerts
                            (watchlist_id, watchlist_name, face_id, camera_id,
                             snapshot_b64, similarity)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (wl_id, entry["name"], face_id, camera_id, snapshot_b64, best_sim),
                    )
                conn.commit()
            except Exception as exc:
                logger.error("WATCHLIST_ALERT_INSERT_ERROR %s", exc)
                conn.rollback()
            finally:
                _pool.putconn(conn)

        logger.info(
            "WATCHLIST_MATCH watchlist_id=%d name=%s face_id=%s camera=%s sim=%.4f",
            wl_id, entry["name"], face_id, camera_id, best_sim,
        )


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="FaceTracker API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Endpoints — Dashboard Data
# ---------------------------------------------------------------------------


@app.get("/stats")
def get_stats():
    """
    Returns:
      total_visitors   — COUNT(*) from faces
      today_visitors   — faces first_seen today
      currently_inside — faces whose most recent event is ENTRY
      avg_dwell_secs   — average dwell_secs from EXIT events today (null if no column)
    """
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Total unique visitors
            cur.execute("SELECT COUNT(*) AS cnt FROM faces")
            total_visitors = cur.fetchone()["cnt"]

            # Today's new visitors (faces first registered today)
            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM faces
                WHERE DATE(first_seen::timestamp) = CURRENT_DATE
                """
            )
            today_visitors = cur.fetchone()["cnt"]

            # Currently inside: faces whose most-recent event is ENTRY
            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM (
                    SELECT DISTINCT ON (face_id) face_id, event_type
                    FROM events
                    ORDER BY face_id, timestamp DESC
                ) latest
                WHERE event_type = 'ENTRY'
                """
            )
            currently_inside = cur.fetchone()["cnt"]

            # avg_dwell_secs — column does not exist in schema; return null
            avg_dwell_secs = None

        return {
            "total_visitors": total_visitors,
            "today_visitors": today_visitors,
            "currently_inside": currently_inside,
            "avg_dwell_secs": avg_dwell_secs,
        }
    except psycopg2.Error as exc:
        logger.error("STATS_ERROR %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)


@app.get("/events")
def get_events():
    """
    Returns last 20 rows from events, ordered by timestamp DESC.
    Fields: face_id, event_type, timestamp, dwell_secs (null), camera_id.
    """
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT face_id,
                       event_type,
                       timestamp,
                       NULL::float AS dwell_secs,
                       camera_id
                FROM   events
                ORDER  BY timestamp DESC
                LIMIT  20
                """
            )
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    except psycopg2.Error as exc:
        logger.error("EVENTS_ERROR %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)


@app.get("/hourly")
def get_hourly(range: str = "day"):
    """
    Returns visitor counts grouped by hour (range=day) or day-of-week (range=week).
    Response: list of {hour: "HH" | "Mon", count: N}
    """
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if range == "week":
                cur.execute(
                    """
                    SELECT TO_CHAR(first_seen::timestamp, 'Dy') AS hour,
                           COUNT(*)                              AS count
                    FROM   faces
                    GROUP  BY TO_CHAR(first_seen::timestamp, 'Dy')
                    ORDER  BY MIN(EXTRACT(ISODOW FROM first_seen::timestamp))
                    """
                )
            else:
                cur.execute(
                    """
                    SELECT TO_CHAR(first_seen::timestamp, 'HH24') AS hour,
                           COUNT(*)                                AS count
                    FROM   faces
                    GROUP  BY hour
                    ORDER  BY hour
                    """
                )
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    except psycopg2.Error as exc:
        logger.error("HOURLY_ERROR %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)


@app.get("/demographics")
def get_demographics():
    """
    Returns Male / Female count from faces.estimated_gender.
    Falls back to mock data {Male: 62, Female: 38} if no gender data exists.
    """
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT estimated_gender, COUNT(*) AS cnt
                FROM   faces
                WHERE  estimated_gender IS NOT NULL
                GROUP  BY estimated_gender
                """
            )
            rows = cur.fetchall()

        if not rows:
            return {"Male": 0, "Female": 0}

        return {row["estimated_gender"]: row["cnt"] for row in rows}
    except psycopg2.Error as exc:
        logger.error("DEMOGRAPHICS_ERROR %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)


# ---------------------------------------------------------------------------
# Streaming — background pipeline thread
# ---------------------------------------------------------------------------


class StreamStart(BaseModel):
    source: str
    path: Optional[str] = None
    url: Optional[str] = None
    camera_id: str = "cam_01"


class StreamStop(BaseModel):
    camera_id: str = "cam_01"


def _run_pipeline(
    source_config: dict,
    camera_id: str,
    frame_queue: queue.Queue,
    stop_event: threading.Event,
) -> None:
    """
    Background thread: open VideoCapture, run detect→track→re-id per frame,
    draw overlay (white boxes for all tracks, red box for search target),
    push annotated frames into frame_queue.
    """
    from modules.config_loader import load_config
    from modules.database import Database
    from modules.face_detector import FaceDetector
    from modules.face_embedder import FaceEmbedder
    from modules.rtsp_stream import RTSPStream
    from modules.face_registry import FaceRegistry
    from modules.face_tracker import FaceTracker

    try:
        cfg = load_config(str(_CONFIG_PATH))
    except Exception as exc:
        logger.error("PIPELINE_CONFIG_ERROR %s", exc)
        return

    source = source_config.get("source", "video")
    capture_target = source_config.get("path") if source == "video" else source_config.get("url")

    if not capture_target:
        logger.error("PIPELINE_NO_SOURCE source=%s config=%s", source, source_config)
        return

    is_rtsp = isinstance(capture_target, str) and capture_target.lower().startswith('rtsp')
    if is_rtsp:
        cap = RTSPStream(capture_target).start()
        if not cap.is_connected:
            logger.error("PIPELINE_CAPTURE_FAILED target=%s", capture_target)
            return
    else:
        cap = cv2.VideoCapture(capture_target)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            logger.error("PIPELINE_CAPTURE_FAILED target=%s", capture_target)
            return

    logger.info("PIPELINE_START camera_id=%s source=%s target=%s", camera_id, source, capture_target)

    try:
        detector = FaceDetector(cfg)
        tracker = FaceTracker(cfg)
        embedder = FaceEmbedder(cfg)
        db = Database(cfg)
        registry = FaceRegistry(cfg, db)
    except Exception as exc:
        logger.error("PIPELINE_INIT_ERROR %s", exc)
        cap.release()
        return

    last_tracks: list = []
    last_resolved: dict = {}
    frame_id = 0

    try:
        while not stop_event.is_set():
            if is_rtsp:
                ret, frame = cap.read()
            else:
                ret, frame = cap.read()
            if not ret:
                if is_rtsp:
                    continue  # RTSPStream may return False briefly during reconnect
                break

            frame_id += 1

            # Run detection + tracking only every N frames
            if frame_id % cfg.detection_skip_frames == 0:
                detections = detector.detect(frame)
                last_tracks = tracker.update(detections, frame)

                for track in last_tracks:
                    tid = track["tracker_id"]
                    if tid not in last_resolved:
                        crop = embedder.crop_face(frame, track["bbox"])
                        if crop is not None:
                            embedding, det_score = embedder.get_embedding(crop)
                            if embedding is not None:
                                face_id, _ = registry.lookup_or_register(embedding, frame_id)
                                last_resolved[tid] = face_id
                                _check_watchlist(camera_id, face_id, embedding, frame, track["bbox"])

                active_ids = {t["tracker_id"] for t in last_tracks}
                last_resolved = {k: v for k, v in last_resolved.items() if k in active_ids}
                _camera_last_resolved[camera_id] = set(last_resolved.values())

            # Draw last known boxes on EVERY frame
            annotated = frame.copy()
            for track in last_tracks:
                x1, y1, x2, y2 = map(int, track["bbox"])
                tid = track["tracker_id"]
                face_id = last_resolved.get(tid, "")
                label = f"#FT-{face_id[:5].upper()}" if face_id else f"T{tid}"
                cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 255, 255), 2)
                cv2.putText(annotated, label, (x1, max(y1 - 8, 0)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1,
                            cv2.LINE_AA)

            # Target highlight: draw red box over matched person
            if _target_embeddings and _target_face_id and _target_face_id != "SEARCHING":
                for track in last_tracks:
                    tid = track.get("tracker_id") or track.get("track_id")
                    fid = last_resolved.get(tid, "")
                    is_target = (fid == _target_face_id)
                    if not is_target and fid and _pool:
                        try:
                            conn = _pool.getconn()
                            try:
                                with conn.cursor() as cur:
                                    cur.execute(
                                        "SELECT embedding FROM faces WHERE face_id=%s", (fid,)
                                    )
                                    row = cur.fetchone()
                                if row:
                                    stored_emb = np.frombuffer(bytes(row[0]), dtype=np.float32)
                                    stored_norm = stored_emb / (np.linalg.norm(stored_emb) + 1e-8)
                                    for t_emb in _target_embeddings:
                                        sim = float(np.dot(stored_norm, t_emb))
                                        if sim > 0.50:
                                            is_target = True
                                            _target_face_id = fid
                                            break
                            finally:
                                _pool.putconn(conn)
                        except Exception:
                            pass
                    if is_target:
                        x1, y1, x2, y2 = map(int, track["bbox"])
                        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 4)
                        cv2.putText(annotated, "TARGET", (x1, max(y1 - 12, 0)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2,
                                    cv2.LINE_AA)

            small = cv2.resize(annotated, (960, 540))
            try:
                frame_queue.put_nowait(small)
            except queue.Full:
                try:
                    frame_queue.get_nowait()
                    frame_queue.put_nowait(small)
                except Exception:
                    pass

    finally:
        if is_rtsp:
            cap.stop()
        else:
            cap.release()
        try:
            db.close()
        except Exception:
            pass
        logger.info("PIPELINE_STOP camera_id=%s frame_id=%d", camera_id, frame_id)


# ---------------------------------------------------------------------------
# Endpoints — Streaming
# ---------------------------------------------------------------------------


@app.post("/stream/start")
def stream_start(body: StreamStart):
    """Start a background pipeline thread for the given video source and camera_id."""
    cam_id = body.camera_id

    # Stop any existing pipeline for this camera
    if cam_id in _cameras:
        _cameras[cam_id]["stop"].set()
        old_thread = _cameras[cam_id]["thread"]
        if old_thread.is_alive():
            old_thread.join(timeout=5)

    stop_event = threading.Event()
    frame_queue = queue.Queue(maxsize=2)

    thread = threading.Thread(
        target=_run_pipeline,
        args=(body.dict(), cam_id, frame_queue, stop_event),
        daemon=True,
    )
    _cameras[cam_id] = {"queue": frame_queue, "thread": thread, "stop": stop_event}
    thread.start()

    logger.info("STREAM_START camera_id=%s source=%s", cam_id, body.source)
    return {"status": "started", "camera_id": cam_id}


@app.post("/stream/stop")
def stream_stop(body: StreamStop):
    """Signal the background pipeline thread for the given camera_id to stop."""
    cam_id = body.camera_id
    if cam_id in _cameras:
        _cameras[cam_id]["stop"].set()
    _camera_last_resolved.pop(cam_id, None)
    logger.info("STREAM_STOP camera_id=%s", cam_id)
    return {"status": "stopped", "camera_id": cam_id}


@app.post("/stream/upload")
async def stream_upload(file: UploadFile = File(...)):
    """Save an uploaded video file to data/uploads/ and return its path."""
    upload_dir = Path(__file__).parent.parent / "data" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / file.filename
    with open(dest, "wb") as f:
        f.write(await file.read())
    logger.info("UPLOAD_SAVED path=%s size=%d", dest, dest.stat().st_size)
    return {"path": str(dest)}


@app.get("/stream/feed")
async def stream_feed(request: Request, camera_id: str = "cam_01"):
    """MJPEG stream of annotated frames from the running pipeline for the given camera."""
    cam = _cameras.get(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"No active stream for camera_id={camera_id}")

    frame_queue = cam["queue"]
    stop_event = cam["stop"]

    async def generate():
        frame_interval = 1.0 / 30  # 30 FPS cap
        last_frame_time = 0.0

        # Wait up to 3 seconds for first frame; send placeholder if none arrives
        pending_frame = None
        for _ in range(60):  # 60 × 50ms = 3 seconds
            if await request.is_disconnected():
                return
            try:
                pending_frame = frame_queue.get_nowait()
                break
            except queue.Empty:
                if stop_event.is_set():
                    return
                await asyncio.sleep(0.05)

        if pending_frame is None:
            placeholder = np.zeros((540, 960, 3), dtype=np.uint8)
            cv2.putText(placeholder, "Connecting...", (350, 270),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            _, buf = cv2.imencode(".jpg", placeholder)
            yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" +
                   buf.tobytes() + b"\r\n")

        try:
            while True:
                if await request.is_disconnected():
                    break
                if pending_frame is not None:
                    frame = pending_frame
                    pending_frame = None
                else:
                    try:
                        frame = frame_queue.get_nowait()
                    except queue.Empty:
                        if stop_event.is_set():
                            break
                        await asyncio.sleep(0.005)
                        continue

                now = time.time()
                elapsed = now - last_frame_time
                if elapsed < frame_interval:
                    await asyncio.sleep(frame_interval - elapsed)
                    continue
                last_frame_time = time.time()

                # Resize to 1280px wide for smooth streaming (keep aspect ratio)
                target_width = 1280
                h, w = frame.shape[:2]
                if w > target_width:
                    scale = target_width / w
                    frame = cv2.resize(
                        frame, (target_width, int(h * scale)),
                        interpolation=cv2.INTER_LINEAR,
                    )

                ret2, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 65])
                if not ret2:
                    continue
                yield (
                    b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                    + buf.tobytes()
                    + b"\r\n"
                )
        except Exception:
            pass

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ---------------------------------------------------------------------------
# Endpoints — Person Search
# ---------------------------------------------------------------------------


def _extract_normalised_embedding(img_bytes: bytes) -> np.ndarray:
    """Decode image bytes, run InsightFace, return L2-normalised 512-dim embedding."""
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Cannot decode uploaded image")
    embedder = _get_search_embedder()
    faces = embedder.app.get(img)
    if not faces:
        raise HTTPException(status_code=400, detail="No face detected in uploaded image")
    emb = np.array(faces[0].embedding, dtype=np.float32)
    return emb / (np.linalg.norm(emb) + 1e-8)


def _search_db_for_target(target_norm: np.ndarray, threshold: float) -> tuple[Optional[str], float]:
    """Return (best_face_id, best_sim) from the faces table, or (None, -1) if below threshold."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT face_id, embedding FROM faces")
            rows = cur.fetchall()
    except psycopg2.Error as exc:
        logger.error("SEARCH_DB_ERROR %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)

    best_id, best_sim = None, -1.0
    for row in rows:
        stored = np.frombuffer(bytes(row["embedding"]), dtype=np.float32)
        stored_norm = stored / (np.linalg.norm(stored) + 1e-8)
        sim = float(np.dot(target_norm, stored_norm))
        if sim > best_sim:
            best_sim, best_id = sim, row["face_id"]

    if best_id and best_sim >= threshold:
        return best_id, best_sim
    return None, best_sim


@app.post("/search/set-target")
async def search_set_target(image: UploadFile = File(...)):
    """
    Upload first photo of a target person. Resets the enrollment list to [this embedding].
    Searches the faces table with cosine similarity >= 0.50.
    Sets _target_face_id to the matched face_id or "SEARCHING" if no match found.
    """
    global _target_embeddings, _target_face_id

    img_bytes = await image.read()
    dest = Path(__file__).parent.parent / "data" / "search_target_0.jpg"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(img_bytes)

    target_norm = await asyncio.to_thread(_extract_normalised_embedding, img_bytes)
    _target_embeddings = [target_norm]

    best_id, best_sim = await asyncio.to_thread(_search_db_for_target, target_norm, 0.50)
    _target_face_id = best_id if best_id else "SEARCHING"
    logger.info("SEARCH_TARGET_SET matched_face_id=%s sim=%.4f photos=1", _target_face_id, best_sim)
    return {"status": "target_set", "matched_face_id": _target_face_id, "total_photos": 1}


@app.post("/search/add-photo")
async def search_add_photo(image: UploadFile = File(...)):
    """
    Upload an additional photo of the same target person (different angle/lighting).
    Appends the new embedding to _target_embeddings and re-runs the DB search
    using all enrolled embeddings (best match across any photo wins).
    """
    global _target_embeddings, _target_face_id

    if not _target_embeddings:
        raise HTTPException(status_code=400, detail="No target set yet. Use /search/set-target first.")

    img_bytes = await image.read()
    idx = len(_target_embeddings)
    dest = Path(__file__).parent.parent / "data" / f"search_target_{idx}.jpg"
    dest.write_bytes(img_bytes)

    new_norm = await asyncio.to_thread(_extract_normalised_embedding, img_bytes)
    _target_embeddings.append(new_norm)

    # Re-run DB search across all enrolled embeddings; keep best match
    best_id, best_sim = None, -1.0
    for t_norm in _target_embeddings:
        fid, sim = await asyncio.to_thread(_search_db_for_target, t_norm, 0.50)
        if sim > best_sim:
            best_sim, best_id = sim, fid

    if best_id:
        _target_face_id = best_id
    # Don't downgrade to SEARCHING if we already had a match
    total = len(_target_embeddings)
    logger.info("SEARCH_PHOTO_ADDED total=%d matched_face_id=%s sim=%.4f", total, _target_face_id, best_sim)
    return {"status": "photo_added", "total_photos": total, "matched_face_id": _target_face_id}


@app.get("/search/status")
def search_status():
    """Returns current search target state."""
    return {
        "target_set": bool(_target_embeddings),
        "matched_face_id": _target_face_id,
        "total_photos": len(_target_embeddings),
    }


@app.post("/search/clear")
def search_clear():
    """Clear the current search target."""
    global _target_embeddings, _target_face_id
    _target_embeddings = []
    _target_face_id = None
    logger.info("SEARCH_TARGET_CLEARED")
    return {"status": "cleared"}


@app.get("/search/active-camera")
def search_active_camera():
    """Return the camera_id currently seeing the target face; falls back to first running cam."""
    if _target_face_id and _target_face_id != "SEARCHING":
        for cam_id, face_ids in _camera_last_resolved.items():
            if _target_face_id in face_ids:
                cam_entry = _cameras.get(cam_id)
                if cam_entry and cam_entry.get("thread") and cam_entry["thread"].is_alive():
                    return {"active_camera": cam_id}
    for cam_id, cam in _cameras.items():
        if cam["thread"].is_alive():
            return {"active_camera": cam_id}
    return {"active_camera": None}


# ---------------------------------------------------------------------------
# Endpoints — Watchlist
# ---------------------------------------------------------------------------


@app.post("/watchlist/add")
async def watchlist_add(name: str = Form(...), photo: UploadFile = File(...)):
    """
    Upload a photo of a person to add to the watchlist.
    Extracts a 512-dim InsightFace embedding and stores it.
    If a person with the same name already exists, appends the new embedding
    to their entry (multi-photo enrollment) instead of creating a duplicate.
    """
    global _watchlist_cache_ts
    import asyncio

    img_bytes = await photo.read()
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Cannot decode uploaded image")

    loop = asyncio.get_event_loop()

    # Load embedder + run inference in a thread — both are CPU-bound/blocking
    def _run_embedder():
        embedder = _get_search_embedder()   # lazy loads 300MB model on first call
        return embedder.app.get(img)

    faces = await loop.run_in_executor(None, _run_embedder)
    if not faces:
        raise HTTPException(status_code=400, detail="No face detected in uploaded photo")
    emb = np.array(faces[0].embedding, dtype=np.float32)
    blob = psycopg2.Binary(emb.tobytes())

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # Check if this name already has a watchlist entry
            cur.execute("SELECT id FROM watchlist WHERE name=%s LIMIT 1", (name,))
            existing = cur.fetchone()

            if existing:
                # Append new embedding to existing person
                wl_id = existing[0]
                cur.execute(
                    "INSERT INTO watchlist_embeddings (watchlist_id, embedding) VALUES (%s, %s)",
                    (wl_id, blob),
                )
                cur.execute(
                    "SELECT COUNT(*) FROM watchlist_embeddings WHERE watchlist_id=%s",
                    (wl_id,),
                )
                total = cur.fetchone()[0]
                conn.commit()
                _watchlist_cache_ts = 0.0
                logger.info("WATCHLIST_EMBEDDING_ADDED id=%d name=%s total=%d", wl_id, name, total)
                return {
                    "id": wl_id,
                    "name": name,
                    "message": f"Added new embedding for {name} (total: {total} embeddings)",
                }
            else:
                # New person: create watchlist row + first embedding row
                photo_b64 = base64.b64encode(img_bytes).decode()
                cur.execute(
                    "INSERT INTO watchlist (name, embedding, photo_b64) VALUES (%s, %s, %s) RETURNING id",
                    (name, blob, photo_b64),
                )
                new_id = cur.fetchone()[0]
                cur.execute(
                    "INSERT INTO watchlist_embeddings (watchlist_id, embedding) VALUES (%s, %s)",
                    (new_id, blob),
                )
                conn.commit()
                _watchlist_cache_ts = 0.0
                logger.info("WATCHLIST_ADDED id=%d name=%s", new_id, name)
                return {"id": new_id, "name": name, "message": "Added to watchlist"}

    except psycopg2.Error as exc:
        logger.error("WATCHLIST_ADD_ERROR %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)


@app.get("/watchlist")
def watchlist_list():
    """Return all watchlist entries (id, name, photo_b64, added_at)."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, name, photo_b64, added_at FROM watchlist ORDER BY added_at DESC"
            )
            rows = cur.fetchall()
    except psycopg2.Error as exc:
        logger.error("WATCHLIST_LIST_ERROR %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "photo_b64": row["photo_b64"],
            "added_at": row["added_at"].isoformat() if row["added_at"] else None,
        }
        for row in rows
    ]


@app.delete("/watchlist/{wl_id}")
def watchlist_delete(wl_id: int):
    """Remove a watchlist entry (cascades to its alerts)."""
    global _watchlist_cache_ts
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM watchlist WHERE id=%s", (wl_id,))
        conn.commit()
    except psycopg2.Error as exc:
        logger.error("WATCHLIST_DELETE_ERROR %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)
    _watchlist_cache_ts = 0.0  # Invalidate cache
    logger.info("WATCHLIST_DELETED id=%d", wl_id)
    return {"status": "deleted", "id": wl_id}


# ---------------------------------------------------------------------------
# Endpoints — Alerts
# ---------------------------------------------------------------------------


@app.get("/alerts")
def get_alerts_endpoint(since: Optional[str] = None, unacknowledged_only: bool = False):
    """
    Return alerts newer than `since` (ISO timestamp).
    Defaults to alerts from the last 60 seconds if `since` is omitted.
    """
    if since:
        since_ts = since
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=60)
        since_ts = cutoff.isoformat()

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            query = """
                SELECT id, watchlist_id, watchlist_name, face_id, camera_id,
                       snapshot_b64, matched_at, similarity, acknowledged
                FROM   alerts
                WHERE  matched_at > %s::timestamp
            """
            params: list = [since_ts]
            if unacknowledged_only:
                query += " AND acknowledged = FALSE"
            query += " ORDER BY matched_at DESC LIMIT 50"
            cur.execute(query, params)
            rows = cur.fetchall()
    except psycopg2.Error as exc:
        logger.error("ALERTS_LIST_ERROR %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)
    return [
        {
            **dict(row),
            "matched_at": row["matched_at"].isoformat() if row["matched_at"] else None,
        }
        for row in rows
    ]


@app.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int):
    """Mark a single alert as acknowledged."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE alerts SET acknowledged=TRUE WHERE id=%s", (alert_id,))
        conn.commit()
    except psycopg2.Error as exc:
        logger.error("ALERT_ACK_ERROR %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _pool.putconn(conn)
    return {"status": "acknowledged", "id": alert_id}
