# Compute Load Estimate — FaceTracker AI

## Test Environment

| Component | Spec |
|---|---|
| CPU | Intel Core i5/i7 (modern laptop, 4–8 cores) |
| RAM | 16 GB |
| GPU | None (CPU-only mode tested) / NVIDIA GTX 1660+ (GPU mode estimate) |
| Input | 1080p video @ 30 FPS |
| OS | Windows 11 |

---

## Per-Stage Breakdown

### CPU-Only Mode

| Pipeline Stage | CPU Usage | Time per Frame | Notes |
|---|---|---|---|
| Video decode (OpenCV) | 5–8% | ~5 ms | Threaded reader, minimal blocking |
| YOLO detection | 15–25% | ~80–120 ms | YOLOv11n-face, runs every 3rd frame |
| ByteTrack tracking | 1–2% | ~2–5 ms | Kalman filter, very lightweight |
| InsightFace embedding | 30–45% | ~100–200 ms | Bottleneck on CPU |
| FAISS similarity search | < 1% | < 1 ms | Sub-millisecond for < 10k faces |
| Quality buffer check | < 1% | < 0.5 ms | In-memory comparison |
| EMA embedding update | < 1% | ~0.5 ms | Vector arithmetic |
| PostgreSQL async write | 3–5% | non-blocking | Background thread, no frame delay |
| FastAPI serving | 2–4% | — | Idle when no browser active |
| **Total (typical)** | **55–80%** | **~150–250 ms** | 8–15 effective FPS |

**Effective FPS (CPU-only):**
- `detection_skip_frames=3` + ByteTrack every frame: **8–15 FPS**
- `detection_skip_frames=1` (every frame): **4–7 FPS** (InsightFace is the bottleneck)
- With embedding skip (`embedding_skip_frames=5`): **12–18 FPS**

---

### GPU Mode (CUDA — Estimated)

| Pipeline Stage | GPU Usage | Time per Frame | Notes |
|---|---|---|---|
| YOLO detection | 15–25% GPU | ~10–15 ms | GPU-accelerated inference |
| InsightFace embedding | 10–20% GPU | ~15–30 ms | Most computation offloaded to GPU |
| ByteTrack tracking | 1–2% CPU | ~2–5 ms | Still runs on CPU |
| FAISS search | < 1% CPU | < 1 ms | CPU FAISS (GPU FAISS not needed at this scale) |
| Video decode | 5% CPU | ~5 ms | OpenCV decode on CPU |
| PostgreSQL write | 3% CPU | non-blocking | Background thread |
| **Total (GPU)** | **~60% GPU, ~15% CPU** | **~30–50 ms** | **25–45 FPS** |

**GPU Memory:**
- InsightFace buffalo_l model: ~600 MB VRAM
- YOLO model: ~100 MB VRAM
- Frame buffer: ~50 MB VRAM
- **Total VRAM: ~800 MB** (comfortably fits in a 4 GB GPU)

---

## RAM Usage

| Component | RAM |
|---|---|
| InsightFace buffalo_l model weights | ~600 MB |
| YOLO model weights | ~80 MB |
| FAISS index (1,000 faces) | ~2 MB |
| FAISS index (10,000 faces) | ~20 MB |
| PostgreSQL connection pool (10 conn) | ~50 MB |
| Python runtime + NumPy + OpenCV | ~200 MB |
| React browser tab | ~80–100 MB |
| **Total (typical session, CPU)** | **~1.0–1.2 GB** |

---

## Scaling Considerations

### With increasing number of registered faces

| Registered Faces | FAISS Search Time | RAM for Index |
|---|---|---|
| 100 | < 0.1 ms | 0.2 MB |
| 1,000 | < 0.2 ms | 2 MB |
| 10,000 | < 0.5 ms | 20 MB |
| 100,000 | < 2 ms | 200 MB |

FAISS IndexFlatIP scales linearly. For 100k+ faces, consider switching to FAISS IndexIVFFlat (approximate nearest neighbor).

### With multiple cameras

| Cameras | CPU Load | RAM |
|---|---|---|
| 1 camera | 55–80% | 1.2 GB |
| 2 cameras | 90–100% | 1.8 GB |
| 4 cameras | > 100% (needs GPU) | 3+ GB |

Multi-camera mode at 4 streams on CPU will saturate the processor. GPU mode is strongly recommended for 2+ simultaneous cameras.

---

## Recommendations for Interview

1. **Use `detection_skip_frames=3`** — balances detection frequency with FPS
2. **Use `embedding_skip_frames=5`** — avoids redundant embeddings for stationary faces
3. **Set `embedding_quality_threshold=0.60`** — allows medium-quality frames to contribute
4. **If GPU available:** set `device=cuda` in config.json — 3–4× FPS improvement
5. **Pre-download buffalo_l** before the interview (requires internet, ~300 MB)
6. **Reduce resolution** if FPS is too low — YOLO with `imgsz=480` instead of 640 saves ~30% compute
