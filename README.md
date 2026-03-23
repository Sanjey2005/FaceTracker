# FaceTracker AI — Intelligent Face Tracker with Auto-Registration and Visitor Counting

A real-time AI-driven face detection, recognition, and visitor counting system built for the Katomaran Hackathon. The system processes live RTSP streams or video files to detect, track, and uniquely count faces — with a full-featured React dashboard for live monitoring.

> **Demo Video:** [Watch the demo on Google Drive](https://drive.google.com/file/d/1ZAHJ27LouksS-4d-n-4zyLJ0O27lprEf/view)

---

## Table of Contents

1. [Architecture](#architecture)
2. [Features](#features)
3. [Tech Stack](#tech-stack)
4. [Setup Instructions](#setup-instructions)
5. [Configuration](#configuration)
6. [AI Planning Document](#ai-planning-document)
7. [Compute Load Estimate](#compute-load-estimate)
8. [Assumptions Made](#assumptions-made)
9. [Sample Output](#sample-output)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INPUT SOURCES                               │
│              Video File (.mp4)  /  Live RTSP Stream                 │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DETECTION LAYER                                   │
│   YOLOv11n-face  ──►  BBox List  ──►  Quality Filter (det_score)   │
│   (every N frames, configurable)       High / Medium / Low tiers    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    TRACKING LAYER                                    │
│   ByteTrack (via supervision)  ──►  Confirmed Tracks + tracker_id  │
│   Runs every frame using cached detections on skip frames           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EMBEDDING LAYER                                   │
│   InsightFace buffalo_l  ──►  512-dim L2-normalised vector          │
│   CLAHE preprocessing (LAB space) for backlit/uneven lighting       │
│   Age + Gender estimation as side output                            │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    RE-IDENTIFICATION LAYER                           │
│   FAISS IndexFlatIP  ──►  Cosine similarity search (top-3)         │
│   Threshold match: EXISTING face_id  /  NEW face_id (UUID)          │
│   Exponential Moving Average (α=0.1) updates stored embedding       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EVENT + LOGGING LAYER                             │
│   Entry / Exit detection  ──►  events.log + DB insert               │
│   Cropped face image saved to logs/entries|exits/YYYY-MM-DD/        │
│   Watchlist alert check (in-memory cache, 30s refresh)              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PERSISTENCE LAYER                                 │
│   PostgreSQL  ──  faces, events, watchlist, alerts tables           │
│   FAISS index persisted to data/faiss_index.bin                     │
│   Background write queue (WAL mode) — non-blocking inference loop   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    API + DASHBOARD LAYER                             │
│   FastAPI  ──►  18 REST endpoints + MJPEG stream                    │
│   React + Vite + Tailwind + Recharts dashboard                      │
│   WebSocket /ws/live — real-time ENTRY/EXIT push                    │
│   7 pages: Dashboard, Cameras, Search, Watchlist, Alerts,           │
│            Analytics, Settings                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Module responsibility map:**

| File | Responsibility |
|---|---|
| `config.json` | Single source of truth for all parameters |
| `modules/config_loader.py` | Loads config → typed Config dataclass |
| `modules/face_detector.py` | YOLOv11n-face wrapper → Detection list with det_score |
| `modules/face_embedder.py` | InsightFace buffalo_l + CLAHE → 512-dim embedding |
| `modules/face_registry.py` | FAISS index, UUID assignment, EMA embedding updates |
| `modules/database.py` | PostgreSQL CRUD, background write queue, schema |
| `pipeline.py` | Main inference loop — orchestrates all modules |
| `api/main.py` | FastAPI backend — REST endpoints + pipeline control |
| `dashboard/src/App.jsx` | React dashboard — 7-page SPA |
| `dashboard/src/Landing.jsx` | Marketing landing page |

---

## Features

### Core (Required)

| Feature | Implementation |
|---|---|
| Real-time face detection | YOLOv11n-face, runs every N frames (configurable) |
| Face embedding generation | InsightFace buffalo_l, 512-dim, 99.83% LFW accuracy |
| Auto-registration of new faces | 8-char UUID assigned on first detection |
| Face re-identification across frames | FAISS cosine similarity, threshold-matched |
| ByteTrack tracking | Continuous tracking between detection frames |
| Entry/Exit event logging | Exactly one log entry per event, cropped image + timestamp |
| Structured image storage | `logs/entries/YYYY-MM-DD/` and `logs/exits/YYYY-MM-DD/` |
| Mandatory events.log | All system events with `key=value` format |
| Unique visitor counting | `COUNT(*) FROM faces` — re-identified faces never double-count |
| Database persistence | PostgreSQL with WAL mode + async write queue |
| config.json control | `detection_skip_frames`, similarity thresholds, all parameters |
| Video file + RTSP support | Both input modes, switchable via config |

### Extra (Beyond Requirements)

| Feature | Description |
|---|---|
| Full React dashboard | 7-page SPA with live stats, charts, event feed |
| Multi-camera support | Up to 4 simultaneous RTSP/video streams |
| Person search | Upload photo → locate specific person across all camera feeds |
| Watchlist + alerts | Enroll persons of interest, get real-time match alerts with snapshots |
| CLAHE preprocessing | Contrast enhancement for backlit/uneven lighting conditions |
| Quality-based buffering | 3-tier system: high (immediate), medium (buffered), low (skipped) |
| EMA embedding updates | α=0.1 exponential moving average refines stored embeddings over time |
| Age + gender estimation | Demographic inference on every registered face |
| Auto-follow camera | Dashboard auto-switches featured camera when search target moves |
| WebSocket live push | Real-time ENTRY/EXIT events pushed to dashboard without polling |
| MJPEG live feed | Annotated video stream served at `/stream/feed` |
| PIN authentication | Dashboard locked behind PIN (localStorage persistence) |
| CSV analytics export | Download all events as CSV from the dashboard |
| Landing page | Animated marketing page with architecture walkthrough |

---

## Tech Stack

| Module | Technology | Reason |
|---|---|---|
| Face Detection | YOLOv11n-face | Lightweight, fast, face-optimised YOLO variant |
| Face Recognition | InsightFace buffalo_l (w600k_r50) | 99.83% LFW accuracy, age/gender free |
| Face Tracking | ByteTrack via `supervision` | 171 FPS, lowest ID-switch rate vs DeepSORT |
| Similarity Search | FAISS IndexFlatIP | Exact cosine similarity, sub-ms search |
| Backend | FastAPI + Python 3.10+ | Async-capable, auto-docs, production-ready |
| Database | PostgreSQL | Robust, concurrent, scales beyond SQLite |
| Frontend | React + Vite + Tailwind + Recharts | Modern stack, zero Streamlit dependency |
| Real-time | WebSocket push + MJPEG stream | No polling — instant event reflection |
| Config | JSON (config.json) | Required by problem statement |
| Logging | Python logging + filesystem + DB | Triple-redundant audit trail |

---

## Setup Instructions

### Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL 14+ running locally
- CUDA-capable GPU (optional, CPU fallback included)

### 1. Clone and install Python dependencies

```bash
git clone <your-repo-url>
cd face-tracker
pip install -r requirements.txt
```

> **Note:** InsightFace buffalo_l model (~300 MB) will auto-download on first run. Pre-download recommended before the interview:
> ```bash
> python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l').prepare(ctx_id=0)"
> ```

### 2. Set up PostgreSQL

```bash
# Create database and user
psql -U postgres -c "CREATE USER faceuser WITH PASSWORD 'facepass';"
psql -U postgres -c "CREATE DATABASE facetracker OWNER faceuser;"
```

### 3. Configure the system

Edit `config.json` (see [Configuration](#configuration) section below).

### 4. Place your video file

Copy your sample video to the project root:
```bash
cp /path/to/your/video.mp4 sample.mp4
```

### 5. Run the pipeline

```bash
# Process video file
python pipeline.py

# Or run via API (starts pipeline through dashboard)
uvicorn api.main:app --reload --port 8000
```

### 6. Start the dashboard (optional)

```bash
cd dashboard
npm install
npm run dev        # Development mode at http://localhost:5173
# OR
npm run build      # Production build served by FastAPI at http://localhost:8000
```

> **Note:** The dashboard is protected by a "Lock" PIN authentication feature. The default password is `1234`. Use this password to unlock the dashboard when prompted.

### 7. Verify it works

```bash
# Check unique visitor count
sqlite3 data/face_tracker.db "SELECT COUNT(*) FROM faces;"

# Tail live events
tail -f logs/events.log

# Check recent events in DB
psql -U faceuser -d facetracker -c "SELECT * FROM events ORDER BY timestamp DESC LIMIT 10;"
```

---

## Configuration

Full `config.json` reference:

```json
{
  "source": "video",
  "video_path": "sample.mp4",
  "rtsp_url": "rtsp://192.168.1.5:8080/h264_ulaw.sdp",

  "detection_skip_frames": 3,
  "embedding_skip_frames": 5,

  "similarity_threshold": 0.55,
  "embedding_quality_threshold": 0.85,

  "min_track_frames": 3,
  "tracker_max_age": 30,
  "max_lost_frames": 30,

  "entry_line_y": 0.5,
  "crowd_threshold": 10,
  "privacy_mode": false,

  "db_path": "data/face_tracker.db",
  "faiss_index_path": "data/faiss_index.bin",
  "log_dir": "logs",

  "yolo_model": "models/yolov11n-face.pt",
  "yolo_confidence": 0.50,
  "device": "cpu",
  "camera_id": "cam_01",
  "use_clahe": true,

  "dashboard_port": 8000,
  "database_url": "postgresql://faceuser:facepass@localhost:5432/facetracker"
}
```

| Parameter | Type | Description |
|---|---|---|
| `source` | string | `"video"` or `"rtsp"` |
| `video_path` | string | Path to video file (used when source=video) |
| `rtsp_url` | string | RTSP stream URL (used when source=rtsp) |
| `detection_skip_frames` | int | Run YOLO every N frames (1 = every frame) |
| `embedding_skip_frames` | int | Generate embeddings every N frames |
| `similarity_threshold` | float | Cosine similarity cutoff for face re-ID (0.0–1.0) |
| `embedding_quality_threshold` | float | Minimum det_score to accept an embedding |
| `min_track_frames` | int | Minimum confirmed frames before registering a face |
| `tracker_max_age` | int | ByteTrack max frames to keep lost track alive |
| `max_lost_frames` | int | Frames after which a lost track triggers EXIT event |
| `entry_line_y` | float | Normalized Y position of the entry line (0.0–1.0) |
| `crowd_threshold` | int | Alert threshold for simultaneous persons in frame |
| `privacy_mode` | bool | If true, suppresses face image saving to disk |
| `db_path` | string | SQLite fallback path (legacy) |
| `faiss_index_path` | string | Path to persist FAISS index |
| `log_dir` | string | Root directory for logs and face images |
| `yolo_model` | string | Path to YOLO model weights file |
| `yolo_confidence` | float | YOLO detection confidence threshold |
| `device` | string | `"cpu"` or `"cuda"` |
| `camera_id` | string | Identifier for this camera stream |
| `use_clahe` | bool | Enable CLAHE contrast enhancement before embedding |
| `dashboard_port` | int | FastAPI server port |
| `database_url` | string | PostgreSQL connection string |

---

## AI Planning Document

### Problem Decomposition

The task was decomposed into six independent modules with clear input/output contracts:

```
1. Config Loader   →  typed Config object
2. Face Detector   →  List[Detection] with bbox + det_score
3. Face Tracker    →  List[Track] with stable tracker_id
4. Face Embedder   →  (embedding: np.ndarray, det_score: float)
5. Face Registry   →  (face_id: str, status: "NEW"|"EXISTING")
6. Database        →  async write queue, sync reads
```

### Key Architectural Decisions

**Dual-layer identity:** Each person has a short-lived `tracker_id` (ByteTrack, resets between sessions) and a persistent `face_id` (UUID, lives in FAISS + DB). This is what prevents double-counting on re-entry.

**Why FAISS over brute-force cosine:** At 512 dimensions and potentially thousands of registered faces, FAISS IndexFlatIP gives exact cosine similarity in sub-millisecond time. L2-normalizing embeddings before indexing makes inner product equivalent to cosine similarity.

**Why EMA over static embeddings:** A single enrollment photo is sensitive to lighting and angle. Updating the stored embedding as a running average (α=0.1) causes it to converge toward the person's "average appearance" over time, improving re-ID stability.

**Why quality filtering:** InsightFace and YOLO both struggle with very small (< 64px) or blurry face crops. Embedding a low-quality crop produces a noisy 512-dim vector that can incorrectly match against a different person. The 3-tier quality system (high/medium/low) prevents garbage embeddings from entering the index.

**Why background write queue:** Any synchronous sqlite3/PostgreSQL write inside the inference loop blocks frame processing. On a CPU-only system, the difference between sync and async writes is 20–40ms per frame — the difference between usable and unusable FPS.

### Planning Steps Followed

1. Read and parsed problem statement
2. Identified mandatory vs optional deliverables
3. Chose tech stack based on accuracy benchmarks (InsightFace > dlib, ByteTrack > DeepSORT)
4. Designed module boundaries and data flow before writing any code
5. Implemented modules in dependency order: config → DB → detector → embedder → registry → pipeline
6. Added API layer and real-time WebSocket
7. Built React dashboard with live stats, camera feeds, and alerting
8. Improved re-ID accuracy: CLAHE preprocessing, EMA updates, quality buffering, multi-photo watchlist matching

### Features Implemented (Complete List)

**Pipeline:**
- YOLOv11n-face detection with configurable skip frames and confidence threshold
- InsightFace buffalo_l embeddings with CLAHE preprocessing
- ByteTrack multi-object tracking with stable IDs
- 3-tier quality buffer (high/medium/low det_score thresholds)
- FAISS cosine similarity re-identification
- Exponential moving average embedding refinement
- Entry/exit event detection with max_lost_frames timeout
- Age and gender demographic estimation
- Line crossing detection (normalized entry_line_y)
- Overlay annotation with active/total counts

**Logging:**
- `logs/events.log` — all system events in `key=value` format
- `logs/entries/YYYY-MM-DD/` — cropped face images on ENTRY
- `logs/exits/YYYY-MM-DD/` — cropped face images on EXIT
- Database events table — face_id, event_type, timestamp, image_path, frame_num, camera_id

**API (18 endpoints):**
- `/stats`, `/events`, `/hourly`, `/demographics` — dashboard data
- `/stream/start`, `/stream/stop`, `/stream/upload`, `/stream/feed` — camera control
- `/search/set-target`, `/search/add-photo`, `/search/status`, `/search/clear`, `/search/active-camera` — person search
- `/watchlist/add`, `/watchlist`, `/watchlist/{id}` — watchlist management
- `/alerts`, `/alerts/{id}/acknowledge` — alert system

**Dashboard (React, 7 pages):**
- Dashboard: live KPI cards, hourly chart, demographics chart, recent events, live feed
- Cameras: multi-camera wizard, start/stop per camera, auto-follow mode
- Search: target photo upload, multi-angle enrollment, real-time match tracking
- Watchlist: enroll persons of interest, multi-photo support
- Alerts: real-time watchlist match notifications with face snapshots
- Analytics: CSV export of all events
- Settings: live config viewer

---

## Compute Load Estimate

### CPU-Only Mode (tested configuration)

| Stage | Load | Notes |
|---|---|---|
| Video decode | ~5–8% CPU | OpenCV threaded reader |
| YOLO detection | ~15–25% CPU | YOLOv11n-face every 3rd frame |
| ByteTrack | ~1–2% CPU | Kalman filter, very lightweight |
| InsightFace embedding | ~30–45% CPU | Heaviest single operation |
| FAISS search | < 1% CPU | Sub-millisecond for < 10k faces |
| PostgreSQL writes | ~3–5% CPU | Async, non-blocking |
| FastAPI + React serving | ~3–5% CPU | Idle when no browser connected |
| **Total (CPU, typical)** | **~55–80% CPU** | Single core often saturated |

**Estimated FPS (CPU-only):**
- Detection every 3 frames + ByteTrack every frame: **8–15 FPS** on modern laptop CPU
- Detection every 1 frame: **3–6 FPS** (embedding is the bottleneck)

### GPU Mode (CUDA)

| Stage | Load | Notes |
|---|---|---|
| YOLO detection | ~15–25% GPU | Batched inference, very fast |
| InsightFace embedding | ~10–20% GPU | Offloaded entirely to GPU |
| CPU load (total) | ~10–15% CPU | Mostly I/O and tracking |
| **Estimated FPS (GPU)** | **25–45 FPS** | Depends on GPU VRAM and model |

### Memory

| Component | RAM Usage |
|---|---|
| InsightFace buffalo_l model | ~600 MB |
| FAISS index (10k faces) | ~20 MB |
| PostgreSQL connection pool | ~50 MB |
| React dashboard (browser) | ~80 MB |
| **Total (typical session)** | **~800 MB – 1.2 GB** |

---

## Assumptions Made

1. **Single camera per pipeline instance** — multi-camera is supported at the API level by spawning multiple pipeline threads, one per camera.
2. **One person per face crop** — crowd scenarios where two faces overlap in one bbox are not handled; ByteTrack ID assignment mitigates most of these.
3. **Face must be frontally visible** for InsightFace to generate a reliable embedding. Side profiles (> 60° yaw) may fail detection.
4. **Minimum face size is 64×64 pixels** — smaller crops produce garbage embeddings and are skipped. Cameras should be positioned accordingly.
5. **re-entry is treated as a new visit** — if a person leaves and re-enters the frame after `max_lost_frames` timeout, they are counted as a new visit but assigned the same `face_id` (not double-counted in unique total).
6. **RTSP stream uses UDP transport** — `OPENCV_FFMPEG_CAPTURE_OPTIONS=rtsp_transport;udp` is set before any OpenCV import.
7. **config.json is the only configuration mechanism** — no environment variables, no CLI overrides (except for `--source` and `--path` in main.py for convenience).
8. **PostgreSQL is available locally** — no Docker or managed cloud DB is assumed.
9. **buffalo_l model downloads automatically** (~300 MB on first run) — internet access required on first launch.
10. **`privacy_mode: false`** — face images are saved to disk by default. Set to `true` to disable image storage.

---

## Sample Output

### events.log excerpt

```
2026-03-22 20:15:01 | INFO | face_detector | YOLO_SKIP config=3
2026-03-22 20:15:02 | INFO | face_embedder | EMBEDDING_GENERATED face_id=a3f1b2c4 det_score=0.92 time_ms=48
2026-03-22 20:15:02 | INFO | face_registry | REID_DECISION tracker_id=1 best_sim=0.00 second_sim=0.00 decision=NEW face_id=a3f1b2c4
2026-03-22 20:15:02 | INFO | pipeline | ENTRY face_id=a3f1b2c4 frame=6 image=logs/entries/2026-03-22/a3f1b2c4_1.jpg
2026-03-22 20:15:45 | INFO | face_registry | REID_DECISION tracker_id=1 best_sim=0.81 second_sim=0.52 decision=EXISTING face_id=a3f1b2c4
2026-03-22 20:16:30 | INFO | pipeline | EXIT face_id=a3f1b2c4 frame=870 image=logs/exits/2026-03-22/a3f1b2c4_exit.jpg
```

### Database — faces table (sample)

| face_id | first_seen | last_seen | visit_count | estimated_age | estimated_gender |
|---|---|---|---|---|---|
| a3f1b2c4 | 2026-03-22 20:15:02 | 2026-03-22 20:16:30 | 1 | 28 | Male |
| b7d9e012 | 2026-03-22 20:17:11 | 2026-03-22 20:19:44 | 1 | 34 | Female |

### Folder structure (logs)

```
logs/
├── events.log
├── entries/
│   └── 2026-03-22/
│       ├── a3f1b2c4_1.jpg
│       └── b7d9e012_1.jpg
└── exits/
    └── 2026-03-22/
        ├── a3f1b2c4_exit.jpg
        └── b7d9e012_exit.jpg
```

---

## Inspecting the Database

```bash
# Count unique visitors
psql -U faceuser -d facetracker -c "SELECT COUNT(*) FROM faces;"

# Recent events
psql -U faceuser -d facetracker -c "SELECT face_id, event_type, timestamp FROM events ORDER BY timestamp DESC LIMIT 10;"

# Demographics breakdown
psql -U faceuser -d facetracker -c "SELECT estimated_gender, COUNT(*) FROM faces GROUP BY estimated_gender;"
```

---

This project is a part of a hackathon run by https://katomaran.com
