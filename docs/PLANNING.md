# AI Planning Document — FaceTracker AI

## 1. Problem Understanding

**Goal:** Build a real-time system that:
1. Detects faces from video/RTSP
2. Assigns each unique person a persistent ID
3. Logs every entry and exit with a timestamped cropped image
4. Counts unique visitors (no double-counting on re-entry)

**Constraints:**
- Must use YOLO for detection
- Must use InsightFace/ArcFace (NOT face_recognition library)
- All parameters through config.json
- Log file + image store + database all mandatory

---

## 2. Prompts Used (AI Workflow)

The following prompt strategy was used to build this system with Claude Code:

### Phase 1 — Architecture Design
> "Design a modular Python architecture for a real-time face tracking system using YOLOv8, InsightFace, ByteTrack, and FAISS. Each module must have a single responsibility and accept a Config dataclass. No global state except in the pipeline orchestrator."

### Phase 2 — Core Modules
> "Implement modules/face_detector.py as a YOLOv8 wrapper that returns a list of Detection dicts with bbox, confidence, and det_score. Use a configurable confidence threshold from the Config object."

> "Implement modules/face_embedder.py using InsightFace buffalo_l. Apply CLAHE on the L channel before embedding. Return a (embedding, det_score) tuple. Guard against crops smaller than 64x64."

> "Implement modules/face_registry.py using FAISS IndexFlatIP on L2-normalised 512-dim vectors. Assign UUID face_ids. Log every REID_DECISION with best_sim, second_sim, and decision."

### Phase 3 — Pipeline Orchestration
> "Implement pipeline.py as the only file that imports all modules. Run ByteTrack every frame, YOLO every N frames. For each confirmed track, generate embedding if not cached, then call face_registry.lookup_or_register. Log ENTRY on first confirmation, EXIT when track is lost for max_lost_frames."

### Phase 4 — Database & API
> "Implement database.py using raw sqlite3 with WAL mode and a background write queue thread. Implement face_registry persistence — save FAISS index to disk, reload on startup."

> "Implement a FastAPI backend with endpoints for: stats, events, hourly counts, demographics, stream start/stop, person search, watchlist management, and alerts."

### Phase 5 — Dashboard
> "Build a React + Vite + Tailwind dashboard with 7 pages: dashboard overview, multi-camera setup, person search, watchlist, alerts, analytics (CSV export), and settings. Use WebSocket for live event push."

### Phase 6 — Accuracy Improvements
> "Improve face re-identification accuracy without changing frontend files. Implement: (1) CLAHE preprocessing, (2) quality-based frame buffering with 3 tiers, (3) exponential moving average embedding updates with FAISS reconstruction, (4) multi-photo watchlist matching."

---

## 3. Feature List (All Implemented Features)

### Face Detection
- YOLOv11n-face model (face-optimised YOLO variant)
- Configurable confidence threshold (`yolo_confidence` in config.json)
- Configurable detection skip frames (`detection_skip_frames` in config.json)
- Minimum face area filter (40×40 px)
- `imgsz=640` explicit size for large frame handling
- Detection objects expose `det_score` attribute for downstream quality filtering

### Face Embedding
- InsightFace buffalo_l backbone (w600k_r50), 512-dimensional embeddings
- CLAHE preprocessing on L-channel (LAB colorspace) for backlit faces
- Face crop with 25% padding on all sides
- Minimum crop size guard (64×64 px — smaller crops skipped)
- Auto-resize of large crops (> 224px → 112px for InsightFace)
- Returns `(embedding, det_score)` tuple
- Age and gender estimation as side output

### Face Tracking
- ByteTrack via `supervision` library
- Runs every frame using cached detections on skip frames
- Stable `tracker_id` per track lifecycle
- `tracker_max_age` and `min_track_frames` configurable

### Face Re-Identification
- FAISS IndexFlatIP on L2-normalised embeddings (exact cosine similarity)
- Top-3 neighbor search, logs `best_sim` and `second_sim`
- Configurable `similarity_threshold`
- Exponential Moving Average (α=0.1) updates stored embedding on every match
- FAISS index persisted to disk, rebuilt from DB on startup

### Quality Filtering (3-Tier System)
- **High** (det_score > 0.85): Immediate registration
- **Medium** (0.60 ≤ det_score ≤ 0.85): Buffer up to 5 frames, keep best quality frame
- **Low** (det_score < 0.60): Skip entirely — too noisy for reliable embedding

### Event Logging
- Entry event: triggered after `min_track_frames` confirmed
- Exit event: triggered after `max_lost_frames` without track
- Cropped face image saved to `logs/entries/YYYY-MM-DD/` and `logs/exits/YYYY-MM-DD/`
- `events.log` entries for: ENTRY, EXIT, REID_DECISION, EMBEDDING_GENERATED, REGISTERED, STREAM_START, STREAM_STOP

### Unique Visitor Counting
- `COUNT(*) FROM faces` table — never derived from events
- Re-identified faces update the same row — visit_count incremented, no new face_id
- Persistent across sessions (FAISS index + DB survive restarts)

### Database
- PostgreSQL with WAL mode + background write queue thread
- Tables: faces, events, system_logs, watchlist, watchlist_embeddings, alerts
- Non-blocking async writes for all INSERT/UPDATE operations
- Synchronous reads with connection pooling (ThreadedConnectionPool, min=1, max=10)
- Schema migration: idempotent multi-embedding population from legacy single-embedding rows

### API (FastAPI, 18 Endpoints)
- `GET /stats` — total, today, currently inside, avg dwell
- `GET /events` — last 20 events
- `GET /hourly` — hourly counts (day or week view)
- `GET /demographics` — gender distribution
- `POST /stream/start` — launch pipeline thread for camera
- `POST /stream/stop` — terminate pipeline thread
- `POST /stream/upload` — upload video file
- `GET /stream/feed` — MJPEG annotated video stream
- `POST /search/set-target` — upload target photo, extract embedding
- `POST /search/add-photo` — add additional angle of same target
- `GET /search/status` — current target state
- `POST /search/clear` — reset search
- `GET /search/active-camera` — camera currently seeing target
- `POST /watchlist/add` — enroll new person with photo
- `GET /watchlist` — list all enrolled persons
- `DELETE /watchlist/{id}` — remove person (cascades to alerts)
- `GET /alerts` — unacknowledged watchlist matches
- `POST /alerts/{id}/acknowledge` — mark alert as seen

### Dashboard (React, 7 Pages)
- **Dashboard:** Live KPI stat cards, hourly bar chart, demographics pie chart, recent events table, live annotated video feed, WebSocket real-time updates
- **Cameras:** Multi-camera wizard (1–4 cameras), source toggle (file/RTSP), start/stop per camera, auto-follow mode (switches featured camera when target detected), localStorage persistence
- **Search:** Target photo upload, multi-angle enrollment, real-time match status, "Found/Searching" indicator
- **Watchlist:** Enroll persons of interest, grid view with thumbnails, multi-photo support, remove entries
- **Alerts:** Real-time watchlist detections with face snapshot (200×200 JPEG), similarity score, acknowledge individual or all
- **Analytics:** CSV export of all events (face_id, event_type, timestamp, dwell_secs, camera_id)
- **Settings:** Live config.json viewer, reload capability

### Additional UI Features
- PIN authentication with localStorage persistence
- Animated landing page with scroll reveal animations
- Auto-follow camera switching with flash animation
- Relative time formatting ("just now", "X mins ago")
- Notification bell with badge and dropdown panel
- Responsive Tailwind layout

---

## 4. Architecture Decisions Log

| Decision | Rationale |
|---|---|
| ByteTrack over DeepSORT | Benchmark: ByteTrack achieves 171 FPS with lower ID-switch rate |
| FAISS IndexFlatIP over brute-force | Sub-millisecond exact cosine search at scale |
| L2-normalise before indexing | Converts inner product to cosine similarity |
| EMA embedding updates (α=0.1) | Convergence to "average appearance", more robust than single-shot enrollment |
| Background write queue | Avoids blocking inference loop — sync sqlite writes cost 20–40ms per frame |
| WAL mode in PostgreSQL | Non-blocking concurrent reads during async writes |
| COUNT(*) FROM faces for unique count | Events table can have duplicates; faces table enforces uniqueness |
| dual-layer ID (tracker_id + face_id) | tracker_id is ephemeral; face_id is persistent across exits/re-entries |
| CLAHE on L-channel before embedding | Handles backlit/poorly lit faces that InsightFace would otherwise miss |
| Quality tier buffering | Prevents noise embeddings from contaminating FAISS index |
| Multi-photo watchlist matching | Max-similarity across all enrolled photos is more robust than single photo |

---

## 5. Module Dependency Graph

```
config.json
    └─► config_loader.py (Config dataclass)
            ├─► face_detector.py (YOLOv11n-face)
            ├─► face_embedder.py (InsightFace buffalo_l)
            ├─► face_registry.py (FAISS + EMA updates)
            │       └─► database.py (async write queue)
            └─► pipeline.py (orchestrator)
                    ├─► imports all modules above
                    └─► api/main.py (spawns pipeline threads)
                            └─► dashboard/src/ (React SPA)
```

---

## 6. Test Plan

| Test | Command | Expected |
|---|---|---|
| Config loads | `python modules/config_loader.py` | Prints all 23 fields |
| DB connects | `python modules/database.py` | Registers + retrieves test face |
| Detector works | `python modules/face_detector.py` | 0 detections on blank frame |
| Embedder works | `python modules/face_embedder.py` | No crash on random noise crop |
| Registry persists | `python modules/face_registry.py` | Register → reload → match |
| Pipeline runs | `python pipeline.py` | Processes frames, writes events.log |
| API responds | `curl http://localhost:8000/stats` | JSON with visitor counts |
| Unique count | `psql -c "SELECT COUNT(*) FROM faces;"` | Matches expected unique visitors |
