# Project Progress

_Last updated: 23 March 2026, hackathon day_

## Requirement vs Implementation

### Module 1 — Face Detection, Recognition & Tracking

| Requirement                                      | Status                                      |
|-------------------------------------------------|---------------------------------------------|
| Process video from file (dev)                   | ✅ Implemented                              |
| Process RTSP stream (interview)                 | ✅ Implemented                              |
| YOLO-based face detection                       | ✅ Implemented (`YOLOv11n-face`)            |
| InsightFace/ArcFace embeddings (no face_recognition) | ✅ Implemented (`buffalo_l`)          |
| Auto-register new faces with unique ID          | ✅ Implemented (8-char UUID)                |
| Store in DB with metadata (ID, timestamp)       | ✅ Implemented                              |
| Recognize + track across frames                 | ✅ Implemented (ByteTrack + FAISS re-ID)    |
| `detection_skip_frames` configurable in `config.json` | ✅ Implemented                       |

### Module 2 — Logging System

| Requirement                                      | Status          |
|-------------------------------------------------|-----------------|
| One entry + one exit log per face               | ✅ Implemented  |
| Log includes cropped face image                 | ✅ Implemented  |
| Log includes timestamp                          | ✅ Implemented  |
| Log includes event type (entry/exit)            | ✅ Implemented  |
| Log includes face ID                            | ✅ Implemented  |
| `logs/entries/YYYY-MM-DD/` folder structure     | ✅ Implemented  |
| All metadata stored in database                 | ✅ Implemented  |
| `events.log` — entry, recognition, tracking, exit | ✅ Implemented |
| `events.log` — embedding generation + registration | ✅ Implemented |

### Module 3 — Unique Visitor Counting

| Requirement                                      | Status                                        |
|-------------------------------------------------|-----------------------------------------------|
| Accurate count of unique faces                  | ✅ Implemented (`COUNT(*) FROM faces`)        |
| Same face re-identified does not increment count| ✅ Implemented (FAISS threshold match)        |
| Count retrievable from DB/API                   | ✅ Implemented (`GET /stats`)                 |

---

## Tech Stack Alignment

| Required                         | Implemented                | Status |
|----------------------------------|---------------------------|--------|
| YOLO (v5/v8+)                    | YOLOv11n-face             | ✅     |
| InsightFace/ArcFace/SOTA        | InsightFace `buffalo_l`   | ✅     |
| ByteTrack/DeepSort/OpenCV       | ByteTrack via `supervision` | ✅   |
| Python backend                  | FastAPI + Python          | ✅     |
| Any DB (SQLite/MongoDB/PostgreSQL) | PostgreSQL             | ✅     |
| `config.json` configuration     | 23 parameters wired       | ✅     |
| Log file + image store + DB     | All three present         | ✅     |
| Video file + RTSP input         | Both supported            | ✅     |

---

## Submission / Evaluation Requirements

| Requirement                                                   | Status          | Notes                                           |
|--------------------------------------------------------------|-----------------|------------------------------------------------|
| AI code generation tools used                                | ✅ Done         | Claude Code                                    |
| Planning document                                            | ✅ Done         | `docs/PLANNING.md` — prompts, decisions, module graph |
| Feature list documentation                                   | ✅ Done         | `docs/PLANNING.md` §3 — full feature list       |
| Compute load estimate (CPU/GPU)                              | ✅ Done         | `docs/COMPUTE_LOAD.md` — per-stage breakdown    |
| Root-level `README.md`                                       | ✅ Done         | Created with all required sections              |
| README: setup instructions                                   | ✅ Done         | PostgreSQL setup, pip install, run commands     |
| README: assumptions made                                     | ✅ Done         | 10 documented assumptions                       |
| README: sample `config.json`                                 | ✅ Done         | Full annotated config table in README           |
| README: AI planning doc + architecture diagram               | ✅ Done         | ASCII architecture + linked to `docs/PLANNING.md` |
| README: Loom/YouTube demo video link                         | ⏳ Pending      | Placeholder present — add link before submit    |
| README: hackathon attribution line                           | ✅ Done         | Added at bottom of README.md                    |
| Submit GitHub repo in Google Form                            | ⏳ Pending      |                                                 |
| Sample output committed (logs, images, DB entries)           | ❌ Missing      | Add small sample set before submitting          |

---

## Extra (Beyond Requirements — Bonus Features)

| Feature                                      | Why It’s Extra / Notes                         |
|----------------------------------------------|------------------------------------------------|
| Full React dashboard (7 pages)               | Frontend “not required, but added advantage”   |
| Multi-camera support (up to 4 streams)       | Not mentioned in requirements                  |
| Person search / target tracking (photo upload)| Not mentioned                                  |
| Watchlist + real-time alert system           | Not mentioned                                  |
| FAISS `IndexFlatIP` similarity search        | Architecture choice beyond baseline            |
| CLAHE preprocessing for backlit faces        | Not mentioned                                  |
| Exponential moving average embedding updates | Not mentioned                                  |
| Three-tier quality buffering (high/med/low)  | Not mentioned                                  |
| Age + gender demographics inference          | Not mentioned                                  |
| PIN authentication for dashboard             | Not mentioned                                  |
| Auto-follow camera switching                 | Not mentioned                                  |
| Marketing landing page                       | Not mentioned                                  |
| WebSocket live push (no polling)             | Not mentioned                                  |
| MJPEG live video feed                        | Not mentioned                                  |
| CSV analytics export                         | Not mentioned                                  |

---

## Bug Fixes Applied (23 Mar)

| Fix | File | Change |
|-----|------|--------|
| P0: Search blocking event loop | `api/main.py:836,865` | `_search_db_for_target()` offloaded via `asyncio.to_thread` |
| P1: 200ms stream key delay | `dashboard/src/App.jsx:234` | `setStreamKey` now fires synchronously on camera change |
| P2: Auto-follow double-switch | `dashboard/src/App.jsx:217` | OR condition replaced with single `featuredCamera` check |
| P3: Auto-follow to crashed cam | `api/main.py:902` | `thread.is_alive()` guard added before returning active camera |

---

## Immediate Next Steps (Before 12 PM)

| Task                                            | Priority | Status   |
|-------------------------------------------------|----------|----------|
| Draft root-level `README.md`                    | High     | ✅ Done  |
| Add setup instructions + assumptions            | High     | ✅ Done  |
| Add sample `config.json` in README              | High     | ✅ Done  |
| Create planning document (`docs/PLANNING.md`)   | High     | ✅ Done  |
| Create architecture diagram (ASCII in README)   | High     | ✅ Done  |
| Create compute load estimate (`docs/COMPUTE_LOAD.md`) | High | ✅ Done |
| Add mandatory katomaran.com attribution line    | High     | ✅ Done  |
| Record and link demo video (Loom/YouTube)       | High     | ⏳ TODO  |
| Commit sample logs, images, and DB entries      | Medium   | ⏳ TODO  |
| Submit GitHub repo in Google Form               | High     | ⏳ TODO  |

