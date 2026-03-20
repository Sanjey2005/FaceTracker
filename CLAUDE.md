# CLAUDE.md — Intelligent Face Tracker (Katomaran Hackathon)

## Project Overview
Real-time AI face tracking system: YOLOv8 detection → InsightFace buffalo_l embeddings → ByteTrack tracking → FAISS re-ID → SQLite logging. Counts unique visitors from video file or RTSP stream. FastAPI backend + React/Vite/Tailwind/Recharts dashboard. Deadline: March 23, 2026 12:00 PM IST.

---

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run pipeline on video file
python main.py --source video --path sample.mp4

# Run pipeline on RTSP stream
python main.py --source rtsp --url rtsp://192.168.1.5:8080/h264_ulaw.sdp

# Start FastAPI backend (serves React build at /)
uvicorn dashboard.api:app --reload --port 8000

# Frontend dev server (development only)
cd dashboard/frontend && npm run dev

# Build frontend for production (output → dashboard/frontend/dist)
cd dashboard/frontend && npm run build

# Run config self-test
python modules/config_loader.py

# Run a specific module self-test
python modules/database.py
python modules/face_registry.py

# Inspect DB from CLI
sqlite3 data/face_tracker.db "SELECT COUNT(*) FROM faces;"
sqlite3 data/face_tracker.db "SELECT * FROM events ORDER BY timestamp DESC LIMIT 10;"

# Tail live log
tail -f logs/events.log
```

---

## Architecture

```
face-tracker/
├── main.py                   # CLI entry point only — argparse, calls pipeline.py
├── config.json               # Single source of truth for all parameters
├── CLAUDE.md                 # This file
├── requirements.txt
│
├── modules/
│   ├── config_loader.py      # Loads config.json → Config dataclass. Stdlib only.
│   ├── database.py           # Raw sqlite3, WAL mode. All CRUD. Background write queue.
│   ├── video_capture.py      # Threaded reader for both file and RTSP. Auto-reconnect.
│   ├── face_detector.py      # YOLOv8 wrapper → returns List[BBox]. Configurable confidence.
│   ├── face_embedder.py      # InsightFace buffalo_l + CLAHE preprocessing → 512-dim numpy array.
│   ├── face_tracker.py       # ByteTrack wrapper via supervision. Returns confirmed tracks.
│   ├── face_registry.py      # FAISS IndexFlatIP. UUID assignment. Disk persistence. Logs every REID_DECISION.
│   ├── event_logger.py       # TRACK_STATES dict. Confirmation buffer. max_lost_frames EXIT trigger.
│   ├── image_store.py        # Saves cropped faces to logs/entries|exits/YYYY-MM-DD/. 25% padding.
│   ├── visitor_counter.py    # Queries DB for unique count. Never derives from events table.
│   └── utils.py              # BBox helpers, cosine similarity, draw_overlay.
│
├── pipeline.py               # ONLY file that imports all modules. Main inference loop.
│
├── dashboard/
│   ├── api.py                # FastAPI. REST + WebSocket /ws/live. Serves dist/ as static.
│   └── frontend/             # React + Vite + Tailwind + Recharts. Built to dist/.
│       └── src/components/
│           ├── StatCards.jsx         # 4 KPI cards, live via WebSocket
│           ├── HourlyChart.jsx       # BarChart — hourly visitor count
│           ├── RecentEntries.jsx     # Last 10 entries, thumbnails + metadata
│           └── DemographicsChart.jsx # PieChart — male/female split
│
├── data/
│   ├── face_tracker.db       # SQLite database
│   └── faiss_index.bin       # Persisted FAISS index (rebuilt from DB on startup if missing)
│
├── models/
│   └── yolov8n-face.pt       # YOLOv8 face detection weights
│
└── logs/
    ├── events.log            # Mandatory. Every system event. Never delete.
    ├── entries/YYYY-MM-DD/   # Cropped face images on ENTRY
    └── exits/YYYY-MM-DD/     # Cropped face images on EXIT
```

---

## Tech Stack & Key Decisions

| Area | Decision | Reason |
|---|---|---|
| Tracker | ByteTrack via `supervision` | 171 FPS, lowest ID switches vs DeepSORT |
| Re-ID | FAISS IndexFlatIP on L2-normalized embeddings | Exact cosine, sub-ms search |
| Identity | Dual-layer: `tracker_id` (short-lived) + `face_id` UUID (persistent) | Prevents double-counting on re-entry |
| DB ORM | Raw `sqlite3` — no SQLAlchemy | Fewer failure points, hackathon scope |
| DB concurrency | WAL mode + background write queue thread | Non-blocking inference loop |
| Face model | InsightFace `buffalo_l` (w600k_r50 backbone) | 99% LFW accuracy, age/gender free |
| Preprocessing | CLAHE on L-channel (LAB space) before embedding | Handles backlit/uneven lighting |
| Exit detection | `max_lost_frames` timeout = PRIMARY trigger | Line crossing is secondary/bonus |
| Unique count | `COUNT(*) FROM faces` — never from events | Events can have duplicates; faces table cannot |
| Frontend | React + Vite + Tailwind + Recharts | No Streamlit — must impress web dev panel |
| Real-time UI | WebSocket `/ws/live` push | No polling; instant ENTRY/EXIT reflection |
| Config | `config.json` exclusively | Problem statement requirement; never hardcode |
| Image storage | Filepath in DB, image on disk (hybrid) | Keeps DB compact |

---

## Code Conventions

- **Naming**: `snake_case` for all Python files, functions, variables. `PascalCase` for dataclasses only.
- **Imports in pipeline.py**: Always import from `modules.module_name` — never relative imports.
- **Logging format**: `%(asctime)s | %(levelname)s | %(module)s | %(message)s` — consistent across all modules.
- **Log event keys**: Always `key=value` pairs inline. Example: `ENTRY face_id=abc123 frame=90 image=path/to/img.jpg`
- **Event type constants**: Always use the `Event` class constants (`Event.ENTRY`, `Event.EXIT`, etc.) — never raw strings.
- **Config access**: Every module accepts a `Config` object as constructor arg — never reads `config.json` directly.
- **No global state** except in `pipeline.py` (frame counter, active tracks dict).
- **Face ID format**: `str(uuid.uuid4())[:8]` — short 8-char UUID for readable logs.
- **Similarity scores**: Always log `best_sim`, `second_sim`, and `decision` on every REID lookup.
- **RTSP env var**: `os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;udp"` must be set before ANY `cv2.VideoCapture` call.
- **Face crops**: Always apply 25% padding + `min_size=64` guard before saving or embedding.
- **React components**: Functional components with hooks only. No class components.
- **WebSocket reconnect**: Exponential backoff in React (`setTimeout` doubling from 1s → 30s cap).

---

## Gotchas & Constraints

- **`os.environ` for RTSP must precede `import cv2`** in video_capture.py — setting it after has no effect.
- **FAISS index rebuild on startup**: If `faiss_index_path` is missing or corrupt, always rebuild silently from `database.load_all_embeddings()` — never crash.
- **DB writes must be off the inference thread** — any synchronous sqlite3 write inside the frame loop will drop FPS below usable range.
- **InsightFace `get()` returns empty list on failed detection** — always guard with `if faces:` before accessing `faces[0].embedding`.
- **`detection_skip_frames` is tested by interviewers** — changing this value in config.json must visibly change YOLO call frequency. Add a log line: `YOLO_SKIP config=N` on startup.
- **`events.log` is mandatory and will be inspected** — every ENTRY, EXIT, REGISTERED, EMBEDDING_GENERATED, STREAM_START, STREAM_STOP must produce a log line.
- **Face crop minimum size**: YOLOv8 bboxes at distance can be 10×10px. The `min_size=64` guard in `image_store.py` must also block embedding generation — tiny crops produce garbage embeddings.
- **`buffalo_l` auto-downloads ~300MB on first run** — document this in README and pre-download before the interview.
- **SQLite WAL mode**: Must set `PRAGMA journal_mode=WAL` and `PRAGMA synchronous=NORMAL` in `init_db()` — not per-connection.
- **ByteTrack `track_buffer`** in supervision maps to `max_lost_frames` in config — keep them in sync.

---

## Out of Scope

- No SQLAlchemy, no Peewee, no other ORM.
- No Streamlit — dashboard is React only.
- No Redis, no Celery, no message queues — background thread queue in database.py is sufficient.
- No Docker for the hackathon submission — plain `pip install` + README setup is enough.
- No authentication on the FastAPI dashboard — unauthenticated local access only.
- No face_recognition Python library (`pip install face_recognition`) — explicitly banned by problem statement.
- No emotion detection, no heatmap module — descoped.
- No multi-camera cross-camera re-ID — single camera only for submission.
- Do not modify `logs/events.log` programmatically (no rotation, no truncation) — append only.
- Do not add Redux or any state management library to React — useState + useEffect is sufficient.
