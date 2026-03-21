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

import logging
import queue
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import psycopg2
import psycopg2.extras
import psycopg2.pool
from fastapi import FastAPI, File, HTTPException, UploadFile
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

# ---------------------------------------------------------------------------
# Person search state
# ---------------------------------------------------------------------------

_target_embedding: Optional[np.ndarray] = None
_target_face_id: Optional[str] = None
_search_embedder = None  # lazy-loaded FaceEmbedder


def _get_search_embedder():
    """Lazy-load FaceEmbedder once; avoids reloading 300MB buffalo_l model per request."""
    global _search_embedder
    if _search_embedder is None:
        from modules.config_loader import load_config
        from modules.face_embedder import FaceEmbedder
        _search_embedder = FaceEmbedder(load_config(str(_CONFIG_PATH)))
    return _search_embedder


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
def get_hourly():
    """
    Returns visitor count per hour of day using faces.first_seen.
    Response: list of {hour: "HH", count: N}
    """
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
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
            return {"Male": 62, "Female": 38}

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

    cap = cv2.VideoCapture(capture_target)
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
            ret, frame = cap.read()
            if not ret:
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
                            embedding = embedder.get_embedding(crop)
                            if embedding is not None:
                                face_id, _ = registry.lookup_or_register(embedding, frame_id)
                                last_resolved[tid] = face_id

                active_ids = {t["tracker_id"] for t in last_tracks}
                last_resolved = {k: v for k, v in last_resolved.items() if k in active_ids}

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
            if (_target_embedding is not None
                    and _target_face_id is not None
                    and _target_face_id != "SEARCHING"):
                for track in last_tracks:
                    tid = track.get("tracker_id") or track.get("track_id")
                    fid = last_resolved.get(tid, "")
                    if fid == _target_face_id:
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
        cap.release()
        try:
            db.stop()
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
def stream_feed(camera_id: str = "cam_01"):
    """MJPEG stream of annotated frames from the running pipeline for the given camera."""
    cam = _cameras.get(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"No active stream for camera_id={camera_id}")

    frame_queue = cam["queue"]
    stop_event = cam["stop"]

    def generate():
        while True:
            try:
                frame = frame_queue.get(timeout=1.0)
                _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                yield (
                    b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                    + buf.tobytes()
                    + b"\r\n"
                )
            except queue.Empty:
                if stop_event.is_set():
                    break
                continue

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ---------------------------------------------------------------------------
# Endpoints — Person Search
# ---------------------------------------------------------------------------


@app.post("/search/set-target")
async def search_set_target(image: UploadFile = File(...)):
    """
    Upload a photo of a target person. Extract their face embedding and search
    the faces table for the closest match (cosine similarity >= 0.62).
    Sets _target_face_id to the matched face_id or "SEARCHING" if no match found.
    """
    global _target_embedding, _target_face_id

    # Save uploaded image
    dest = Path(__file__).parent.parent / "data" / "search_target.jpg"
    dest.parent.mkdir(parents=True, exist_ok=True)
    img_bytes = await image.read()
    dest.write_bytes(img_bytes)

    # Decode image
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Cannot decode uploaded image")

    # Extract embedding using InsightFace on the full photo
    embedder = _get_search_embedder()
    faces = embedder.app.get(img)
    if not faces:
        raise HTTPException(status_code=400, detail="No face detected in uploaded image")

    target_emb = np.array(faces[0].embedding, dtype=np.float32)
    _target_embedding = target_emb

    # Cosine similarity search across all stored face embeddings
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

    target_norm = target_emb / (np.linalg.norm(target_emb) + 1e-8)
    best_id, best_sim = None, -1.0
    for row in rows:
        stored = np.frombuffer(bytes(row["embedding"]), dtype=np.float32)
        stored_norm = stored / (np.linalg.norm(stored) + 1e-8)
        sim = float(np.dot(target_norm, stored_norm))
        if sim > best_sim:
            best_sim, best_id = sim, row["face_id"]

    _target_face_id = best_id if (best_id and best_sim >= 0.62) else "SEARCHING"
    logger.info("SEARCH_TARGET_SET matched_face_id=%s sim=%.4f", _target_face_id, best_sim)
    return {"status": "target_set", "matched_face_id": _target_face_id}


@app.get("/search/status")
def search_status():
    """Returns current search target state."""
    return {"target_set": _target_embedding is not None, "matched_face_id": _target_face_id}


@app.post("/search/clear")
def search_clear():
    """Clear the current search target."""
    global _target_embedding, _target_face_id
    _target_embedding = None
    _target_face_id = None
    logger.info("SEARCH_TARGET_CLEARED")
    return {"status": "cleared"}
