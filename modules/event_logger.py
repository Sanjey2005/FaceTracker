"""
event_logger.py — Entry/exit event detection via track state management.

Maintains a module-level TRACK_STATES dict (tracker_id → state) that
survives EventLogger re-instantiation, mirroring the lifetime of the
pipeline's active tracks.

Allowed imports: numpy, logging, pathlib, datetime + Config, Database, ImageStore.
"""

import logging
from datetime import datetime
from pathlib import Path

import numpy as np

from modules.config_loader import Config
from modules.database import Database
from modules.image_store import ImageStore

logger = logging.getLogger(__name__)

# Module-level: persists across EventLogger instances (same lifetime as pipeline).
# tracker_id (int) → {
#     "face_id": str,
#     "entry_logged": bool,
#     "entry_time": str,       # ISO-8601 timestamp of ENTRY event
#     "last_bbox": list,
#     "confirmed_frames": int,
#     "last_frame": int,
#     "camera_id": str,
# }
TRACK_STATES: dict = {}


class EventLogger:
    """Detects ENTRY and EXIT events from per-frame track updates.

    Combines a confirmation buffer (``min_track_frames``) to avoid spurious
    entries with a ``max_lost_frames`` timeout to trigger exits when a track
    disappears.  Optional line-crossing logic provides a secondary EXIT
    signal.

    All events are written to the database and the mandatory ``events.log``
    via the standard Python logging infrastructure (caller must configure
    handlers).
    """

    def __init__(self, cfg: Config, db: Database, image_store: ImageStore) -> None:
        """Initialise EventLogger.

        Args:
            cfg: Loaded Config dataclass instance.
            db: Initialised Database instance for event persistence.
            image_store: Initialised ImageStore instance for crop persistence.
        """
        self.cfg = cfg
        self.db = db
        self.image_store = image_store
        self.line_y = cfg.entry_line_y
        self.min_frames = cfg.min_track_frames
        self.max_lost = cfg.max_lost_frames

        logger.info(
            "EVENTLOGGER_INIT line_y=%.2f min_frames=%d max_lost=%d",
            self.line_y,
            self.min_frames,
            self.max_lost,
        )

    # ------------------------------------------------------------------
    # Per-frame update
    # ------------------------------------------------------------------

    def update_track(
        self,
        tracker_id: int,
        face_id: str,
        bbox: list,
        frame: np.ndarray,
        frame_id: int,
        timestamp: str,
    ) -> None:
        """Process one active track for this frame.

        Creates a new state entry for unseen tracker IDs, increments the
        confirmation counter, and fires an ENTRY event once the track reaches
        ``min_track_frames`` confirmed frames.

        Args:
            tracker_id: Integer ID assigned by ByteTrack for this track.
            face_id: Persistent face UUID from the registry.
            bbox: Current bounding box ``[x1, y1, x2, y2]`` in pixels.
            frame: Full BGR frame as a numpy array.
            frame_id: Frame sequence number within the current stream.
            timestamp: ISO-8601 string for the current frame time.
        """
        if tracker_id not in TRACK_STATES:
            TRACK_STATES[tracker_id] = {
                "face_id": face_id,
                "entry_logged": False,
                "entry_time": timestamp,
                "last_bbox": bbox,
                "confirmed_frames": 0,
                "last_frame": frame_id,
                "camera_id": self.cfg.camera_id,
            }

        state = TRACK_STATES[tracker_id]
        state["face_id"] = face_id
        state["last_bbox"] = bbox
        state["last_frame"] = frame_id
        state["confirmed_frames"] += 1

        if not state["entry_logged"] and state["confirmed_frames"] >= self.min_frames:
            image_path = self.image_store.save(
                frame, bbox, face_id, "entry", timestamp
            )
            self.db.log_event(
                face_id,
                "ENTRY",
                timestamp,
                image_path or "",
                frame_num=frame_id,
                camera_id=state["camera_id"],
            )
            state["entry_logged"] = True
            state["entry_time"] = timestamp
            logger.info(
                "ENTRY face_id=%s frame=%d image=%s",
                face_id,
                frame_id,
                image_path or "none",
            )

    # ------------------------------------------------------------------
    # Lost-track sweep
    # ------------------------------------------------------------------

    def check_lost_tracks(
        self,
        active_tracker_ids: set,
        current_frame: int,
        timestamp: str,
        frame: np.ndarray,
    ) -> None:
        """Sweep TRACK_STATES for tracks that have been absent too long.

        For each tracked ID that is no longer in *active_tracker_ids*, counts
        the frames since it was last seen.  Once that count reaches
        ``max_lost_frames`` an EXIT event is fired (if an ENTRY was previously
        confirmed) and the state is removed.

        Args:
            active_tracker_ids: Set of tracker IDs present in the current frame.
            current_frame: Current frame sequence number.
            timestamp: ISO-8601 string for the current frame time.
            frame: Full BGR frame (used for the exit crop).
        """
        lost_ids = [
            tid for tid in list(TRACK_STATES.keys())
            if tid not in active_tracker_ids
        ]

        for tracker_id in lost_ids:
            state = TRACK_STATES[tracker_id]
            frames_lost = current_frame - state["last_frame"]

            if frames_lost >= self.max_lost:
                face_id = state["face_id"]

                if state["entry_logged"]:
                    image_path = self.image_store.save(
                        frame, state["last_bbox"], face_id, "exit", timestamp
                    )
                    self.db.log_event(
                        face_id,
                        "EXIT",
                        timestamp,
                        image_path or "",
                        frame_num=current_frame,
                        camera_id=state["camera_id"],
                    )

                    try:
                        dwell_secs = (
                            datetime.fromisoformat(timestamp)
                            - datetime.fromisoformat(state["entry_time"])
                        ).total_seconds()
                    except ValueError:
                        dwell_secs = 0.0

                    logger.info(
                        "EXIT face_id=%s frame=%d trigger=max_lost_frames dwell_secs=%.1f",
                        face_id,
                        current_frame,
                        dwell_secs,
                    )

                del TRACK_STATES[tracker_id]

    # ------------------------------------------------------------------
    # Line-crossing detection (secondary / bonus trigger)
    # ------------------------------------------------------------------

    def check_line_crossing(
        self,
        tracker_id: int,
        face_id: str,
        bbox: list,
        frame_height: int,
        frame: np.ndarray,
        frame_id: int,
        timestamp: str,
    ) -> str | None:
        """Detect whether a track has crossed the configured horizontal line.

        Compares the vertical centroid of the current bounding box against the
        centroid stored in TRACK_STATES to detect upward or downward crossing
        of ``self.line_y`` (a fraction of frame height, 0–1).

        Must be called *before* ``update_track`` updates ``last_bbox``, or
        at least after an initial state entry has been created.

        Args:
            tracker_id: ByteTrack ID for this track.
            face_id: Persistent face UUID.
            bbox: Current bounding box ``[x1, y1, x2, y2]``.
            frame_height: Height of the frame in pixels.
            frame: Full BGR frame.
            frame_id: Current frame sequence number.
            timestamp: ISO-8601 string for the current frame time.

        Returns:
            ``'ENTRY_CROSS'`` or ``'EXIT_CROSS'`` if a crossing was detected,
            ``None`` otherwise.
        """
        if tracker_id not in TRACK_STATES:
            return None

        prev_bbox = TRACK_STATES[tracker_id]["last_bbox"]
        if not prev_bbox:
            return None

        current_cy = (bbox[1] + bbox[3]) / 2 / frame_height
        prev_cy = (prev_bbox[1] + prev_bbox[3]) / 2 / frame_height
        line = self.line_y

        direction = None
        if prev_cy < line <= current_cy:
            direction = "ENTRY_CROSS"
        elif prev_cy >= line > current_cy:
            direction = "EXIT_CROSS"

        if direction:
            logger.info(
                "LINE_CROSS face_id=%s direction=%s frame=%d",
                face_id,
                direction,
                frame_id,
            )

        return direction

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get_active_count(self) -> int:
        """Return the number of tracks that have a confirmed ENTRY.

        Returns:
            Integer count of TRACK_STATES entries where ``entry_logged`` is
            ``True``.
        """
        return sum(1 for s in TRACK_STATES.values() if s["entry_logged"])

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Clear all track states (call between video segments or on restart).

        Modifies the module-level ``TRACK_STATES`` dict in-place so the clear
        is visible to all code that holds a reference to the dict.
        """
        TRACK_STATES.clear()
        logger.info("EVENTLOGGER_RESET")
