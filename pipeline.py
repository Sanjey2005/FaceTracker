"""
pipeline.py — Main inference orchestrator for the face-tracker system.

This is the ONLY file that imports all modules together.  It wires
detection → embedding → tracking → identity → event logging into a
single frame-processing loop, with an annotated overlay window.

No other module may import from this file.
"""

import logging
import signal
import sys

import cv2
import numpy as np

from modules.config_loader import load_config, get_device, Config
from modules.database import Database
from modules.video_capture import VideoCapture
from modules.face_detector import FaceDetector
from modules.face_embedder import FaceEmbedder
from modules.face_tracker import FaceTracker
from modules.face_registry import FaceRegistry
from modules.event_logger import EventLogger, TRACK_STATES
from modules.image_store import ImageStore
from modules.visitor_counter import VisitorCounter
from modules.utils import draw_overlay, format_timestamp

logger = logging.getLogger(__name__)

_QUALITY_BUFFER_MIN_SCORE = 0.60   # minimum det_score to buffer (below = skip)
_QUALITY_BUFFER_MAX_FRAMES = 5     # flush buffer after this many acceptable frames


class Pipeline:
    """End-to-end face tracking pipeline.

    Initialises every sub-module, runs the main frame loop, and handles
    graceful shutdown on SIGINT / SIGTERM or video EOF.
    """

    def __init__(self, cfg: Config) -> None:
        """Wire up all modules and configure logging.

        Args:
            cfg: Loaded Config dataclass instance.
        """
        # --- Logging setup (file + stdout) ---
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.INFO)
        # Avoid duplicate handlers on re-init
        if not root_logger.handlers:
            fmt = logging.Formatter(
                "%(asctime)s | %(levelname)s | %(module)s | %(message)s"
            )
            fh = logging.FileHandler("logs/events.log")
            fh.setFormatter(fmt)
            sh = logging.StreamHandler()
            sh.setFormatter(fmt)
            root_logger.addHandler(fh)
            root_logger.addHandler(sh)

        self.cfg = cfg

        # --- Module initialisation (order matters) ---
        self.db = Database(cfg)
        self.image_store = ImageStore(cfg)
        self.detector = FaceDetector(cfg)
        self.embedder = FaceEmbedder(cfg)
        self.tracker = FaceTracker(cfg)
        self.registry = FaceRegistry(cfg, self.db)
        self.event_logger = EventLogger(cfg, self.db, self.image_store)
        self.visitor_counter = VisitorCounter(self.db)
        self.capture = VideoCapture(cfg)

        self.frame_id = 0
        self.resolved_ids: dict[int, str] = {}  # tracker_id → face_id
        self._quality_buffer: dict[int, dict] = {}  # tracker_id → {embedding, det_score, frame_count}
        self.device = get_device(cfg)
        self._shutdown_requested = False

        # --- Graceful shutdown on signals ---
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

        logger.info(
            "PIPELINE_INIT device=%s skip_frames=%d threshold=%.4f",
            self.device,
            cfg.detection_skip_frames,
            cfg.similarity_threshold,
        )

    # ------------------------------------------------------------------
    # Signal handling
    # ------------------------------------------------------------------

    def _signal_handler(self, signum: int, frame) -> None:
        """Mark shutdown requested so the main loop exits cleanly."""
        logger.info("SIGNAL_RECEIVED signum=%d", signum)
        self._shutdown_requested = True

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    def run(self) -> None:
        """Start the capture source and run the frame-processing loop.

        The loop exits on video EOF, 'q' keypress, or SIGINT/SIGTERM.
        """
        self.capture.start()
        logger.info("STREAM_START source=%s", self.cfg.source)

        while self.capture.is_running() and not self._shutdown_requested:
            frame = self.capture.read()
            if frame is None:
                continue

            self.frame_id += 1
            timestamp = format_timestamp()
            frame_h, frame_w = frame.shape[:2]

            # ── Detection (every N frames) ──────────────────────
            if self.frame_id % self.cfg.detection_skip_frames == 0:
                detections = self.detector.detect(frame)
            else:
                detections = []

            # ── Tracking (every frame) ──────────────────────────
            tracks = self.tracker.update(detections, frame)
            if self.frame_id % 30 == 0:
                logger.info(f"TRACKS_DEBUG frame={self.frame_id} detections={len(detections)} tracks={len(tracks)}")
            active_ids = {t["tracker_id"] for t in tracks}

            # ── Identity resolution ─────────────────────────────
            for track in tracks:
                tid = track["tracker_id"]

                if tid not in self.resolved_ids:
                    crop = self.embedder.crop_face(frame, track["bbox"])
                    if crop is not None:
                        embedding, det_score = self.embedder.get_embedding(crop)
                        if embedding is not None:
                            if det_score > self.cfg.embedding_quality_threshold:
                                # High quality — register/match immediately
                                face_id, status = self.registry.lookup_or_register(
                                    embedding, self.frame_id
                                )
                                self.resolved_ids[tid] = face_id
                                if status == "NEW":
                                    age, gender = self.embedder.get_age_gender(crop)
                                    self.db.update_face_demographics(face_id, age, gender)
                                self._quality_buffer.pop(tid, None)

                            elif det_score >= _QUALITY_BUFFER_MIN_SCORE:
                                # Medium quality — buffer until best frame or count reached
                                if tid not in self._quality_buffer:
                                    self._quality_buffer[tid] = {
                                        "embedding": embedding,
                                        "det_score": det_score,
                                        "frame_count": 1,
                                    }
                                else:
                                    if det_score > self._quality_buffer[tid]["det_score"]:
                                        self._quality_buffer[tid]["embedding"] = embedding
                                        self._quality_buffer[tid]["det_score"] = det_score
                                    self._quality_buffer[tid]["frame_count"] += 1

                                if self._quality_buffer[tid]["frame_count"] >= _QUALITY_BUFFER_MAX_FRAMES:
                                    best = self._quality_buffer.pop(tid)
                                    face_id, status = self.registry.lookup_or_register(
                                        best["embedding"], self.frame_id
                                    )
                                    self.resolved_ids[tid] = face_id
                                    if status == "NEW":
                                        age, gender = self.embedder.get_age_gender(crop)
                                        self.db.update_face_demographics(face_id, age, gender)
                            # det_score < _QUALITY_BUFFER_MIN_SCORE: skip entirely

                # ── Event logging ───────────────────────────────
                if tid in self.resolved_ids:
                    face_id = self.resolved_ids[tid]

                    # Line crossing checked BEFORE update_track refreshes last_bbox
                    self.event_logger.check_line_crossing(
                        tid, face_id, track["bbox"],
                        frame_h, frame, self.frame_id, timestamp,
                    )
                    self.event_logger.update_track(
                        tid, face_id, track["bbox"],
                        frame, self.frame_id, timestamp,
                    )

            # ── Exit detection ──────────────────────────────────
            self.event_logger.check_lost_tracks(
                active_ids, self.frame_id, timestamp, frame,
            )

            # Clean resolved_ids for tracks that have been fully removed
            for tid in list(self.resolved_ids.keys()):
                if tid not in active_ids and tid not in TRACK_STATES:
                    del self.resolved_ids[tid]

            # Flush quality_buffer for tracks that have left without hitting high quality.
            # Registers with best available embedding so nobody is silently dropped.
            for tid in list(self._quality_buffer.keys()):
                if tid not in active_ids:
                    buffered = self._quality_buffer.pop(tid)
                    face_id, status = self.registry.lookup_or_register(
                        buffered["embedding"], self.frame_id
                    )
                    logger.warning(
                        "LOW_QUALITY_REGISTRATION track=%d best_det_score=%.2f",
                        tid, buffered["det_score"],
                    )
                    if status == "NEW":
                        self.db.update_face_demographics(face_id, None, None)

            # ── Visitor count log (every 30 frames) ─────────────
            if self.frame_id % 30 == 0:
                self.visitor_counter.log_count(self.frame_id)

            # ── Display overlay ─────────────────────────────────
            try:
                annotated = draw_overlay(
                    frame,
                    tracks,
                    self.resolved_ids,
                    self.event_logger.get_active_count(),
                    self.visitor_counter.get_total_unique(),
                    entry_line_y=self.cfg.entry_line_y,
                    frame_id=self.frame_id,
                )
                cv2.imshow("Face Tracker", annotated)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            except cv2.error:
                # Headless environment — skip display silently
                pass

        self.shutdown()

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    def shutdown(self) -> None:
        """Stop all modules and persist state.

        Logs STREAM_STOP, saves the FAISS index, flushes and closes the
        database, and prints the final unique visitor count.
        """
        logger.info("STREAM_STOP")
        self.capture.stop()
        self.registry.save()
        self.db.flush()

        unique = self.visitor_counter.get_total_unique()

        self.visitor_counter.close()
        self.db.close()

        try:
            cv2.destroyAllWindows()
        except cv2.error:
            pass

        logger.info("PIPELINE_SHUTDOWN unique_visitors=%d", unique)
        logger.info("UNIQUE_VISITORS count=%d", unique)
