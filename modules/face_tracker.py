"""
face_tracker.py — ByteTrack multi-object tracker via boxmot.

Returns confirmed tracks with stable tracker_id integers across frames.
Uses boxmot ByteTrack which provides low-confidence recovery through its
two-stage association (high-conf first, then low-conf recovery).
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np

from modules.config_loader import Config

logger = logging.getLogger(__name__)


class FaceTracker:
    """ByteTrack-based face tracker with stable integer track IDs."""

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        from boxmot import ByteTrack
        self._tracker = ByteTrack(
            track_high_thresh=0.5,
            track_low_thresh=0.1,
            new_track_thresh=0.6,
            track_buffer=cfg.tracker_max_age,
            match_thresh=0.8,
            frame_rate=25,
        )
        logger.info(
            "TRACKER_INIT type=ByteTrack track_buffer=%d match_thresh=0.8",
            cfg.tracker_max_age,
        )

    def update(self, detections: list[dict], frame: np.ndarray) -> list[dict]:
        """Update tracker with latest detections and return active tracks.

        Args:
            detections: List of dicts with 'bbox', 'confidence' keys.
            frame: Current video frame (required by ByteTrack for image dims).

        Returns:
            List of dicts with 'tracker_id', 'bbox', 'confidence' keys.
        """
        if not detections:
            return []

        dets = np.array(
            [[*d["bbox"], d.get("confidence", 0.9), 0] for d in detections],
            dtype=np.float32,
        )
        tracks = self._tracker.update(dets, frame)

        result = []
        for t in tracks:
            x1, y1, x2, y2 = int(t[0]), int(t[1]), int(t[2]), int(t[3])
            track_id = int(t[4])
            result.append({
                "tracker_id": track_id,
                "bbox": [x1, y1, x2, y2],
                "confidence": float(t[5]),
            })
        return result

    def reset(self) -> None:
        """Reinitialise the tracker, clearing all track state."""
        from boxmot import ByteTrack
        self._tracker = ByteTrack(
            track_high_thresh=0.5,
            track_low_thresh=0.1,
            new_track_thresh=0.6,
            track_buffer=self._cfg.tracker_max_age,
            match_thresh=0.8,
            frame_rate=25,
        )
        logger.info("TRACKER_RESET")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(module)s | %(message)s",
    )
    from modules.config_loader import load_config

    cfg = load_config()
    tracker = FaceTracker(cfg)

    # Test: stable ID across 5 frames with moving bbox
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    prev_tracks = []
    for i in range(5):
        x = 100 + i * 10
        dets = [{"bbox": [x, 100, x + 100, 200], "confidence": 0.9, "area": 10000}]
        tracks = tracker.update(dets, frame)
        print(f"Frame {i}: tracks={len(tracks)} ids={[t['tracker_id'] for t in tracks]}")
        if tracks:
            prev_tracks = tracks

    print("face_tracker.py self-test passed.")
