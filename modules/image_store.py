"""
image_store.py — Cropped face image storage with padded crops.

Saves JPEG crops to logs/entries/<YYYY-MM-DD>/ and logs/exits/<YYYY-MM-DD>/.
All path construction is relative to cfg.log_dir. cv2 and numpy only.

Allowed imports: cv2, numpy, logging, pathlib + Config.
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import cv2
import numpy as np

from modules.config_loader import Config

logger = logging.getLogger(__name__)


class ImageStore:
    """Persists padded face crops to disk, organised by event type and date.

    Directory layout::

        log_dir/
          entry/YYYY-MM-DD/<face_id>_<timestamp>.jpg
          exit/YYYY-MM-DD/<face_id>_<timestamp>.jpg
    """

    def __init__(self, cfg: Config) -> None:
        """Initialise ImageStore.

        Args:
            cfg: Loaded Config dataclass instance.
        """
        self.log_dir = Path(cfg.log_dir)
        self.min_size = 64
        self.padding = 0.25
        logger.info("IMAGESTORE_INIT log_dir=%s", self.log_dir)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def save(
        self,
        frame: np.ndarray,
        bbox: list,
        face_id: str,
        event_type: str,
        timestamp: str,
    ) -> str | None:
        """Crop, pad, and save a face image to the appropriate directory.

        Args:
            frame: Full video frame as a BGR numpy array.
            bbox: Bounding box [x1, y1, x2, y2] in pixel coordinates.
            face_id: Short UUID string for this face.
            event_type: ``'entry'`` or ``'exit'`` — used as a sub-directory name.
            timestamp: ISO-8601 timestamp string (e.g. ``'2026-03-20T20:30:00'``).

        Returns:
            Absolute file path as a string if the crop was saved successfully,
            or ``None`` if the crop was too small to be useful.
        """
        date_str = timestamp[:10]  # YYYY-MM-DD
        folder_map = {
            "entry": "entries", "ENTRY": "entries",
            "exit": "exits",    "EXIT":  "exits",
        }
        folder_name = folder_map.get(event_type, event_type)
        folder = self.log_dir / folder_name / date_str
        folder.mkdir(parents=True, exist_ok=True)

        crop = self._crop_with_padding(frame, bbox)
        if crop is None:
            logger.warning(
                "IMAGE_SKIP face_id=%s reason=crop_too_small bbox=%s",
                face_id,
                bbox,
            )
            return None

        # Build filename — strip separators from timestamp so it is filesystem-safe.
        ts_safe = (
            timestamp.replace(":", "").replace("-", "").replace("T", "_")[:15]
        )
        filename = f"{face_id}_{ts_safe}.jpg"
        filepath = folder / filename

        cv2.imwrite(str(filepath), crop, [cv2.IMWRITE_JPEG_QUALITY, 95])

        h, w = crop.shape[:2]
        logger.info("IMAGE_SAVED path=%s size=%dx%d", filepath, w, h)
        return str(filepath)

    def get_thumbnail(self, face_id: str) -> str | None:
        """Return the path of the first saved entry crop for a given face.

        Args:
            face_id: Short UUID string to search for.

        Returns:
            String file path of the first match, or ``None`` if not found.
        """
        entry_dir = self.log_dir / "entries"
        for match in sorted(entry_dir.glob(f"**/{face_id}_*.jpg")):
            return str(match)
        return None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _crop_with_padding(
        self, frame: np.ndarray, bbox: list
    ) -> np.ndarray | None:
        """Return a padded crop from *frame* bounded by *bbox*.

        Padding of ``self.padding`` (25 %) is added on each side, clamped to
        frame dimensions.  Returns ``None`` if the resulting crop is smaller
        than ``self.min_size`` in either dimension.

        Args:
            frame: Full BGR frame.
            bbox: ``[x1, y1, x2, y2]`` bounding box.

        Returns:
            Cropped numpy array, or ``None`` if the crop is too small.
        """
        x1, y1, x2, y2 = map(int, bbox)
        h, w = frame.shape[:2]

        pw = int((x2 - x1) * self.padding)
        ph = int((y2 - y1) * self.padding)

        x1 = max(0, x1 - pw)
        y1 = max(0, y1 - ph)
        x2 = min(w, x2 + pw)
        y2 = min(h, y2 + ph)

        crop = frame[y1:y2, x1:x2]

        if crop.shape[0] < self.min_size or crop.shape[1] < self.min_size:
            return None

        return crop


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(module)s | %(message)s",
    )

    from modules.config_loader import load_config

    cfg = load_config()
    store = ImageStore(cfg)

    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    dummy_frame[100:300, 150:350] = 128  # grey face region

    bbox = [150, 100, 350, 300]
    path = store.save(dummy_frame, bbox, "test_face", "entry", "2026-03-20T20:30:00")
    print(f"Saved to: {path}")
    assert path is not None
    assert Path(path).exists()

    # Verify thumbnail lookup works
    thumb = store.get_thumbnail("test_face")
    print(f"Thumbnail: {thumb}")
    assert thumb is not None
    assert thumb == path

    # Test crop-too-small rejection (1×1 bbox with no padding growth)
    tiny_bbox = [10, 10, 11, 11]
    result = store.save(dummy_frame, tiny_bbox, "test_face", "entry", "2026-03-20T20:31:00")
    assert result is None, f"Expected None for tiny crop, got {result}"
    print("Tiny crop correctly rejected.")

    print("image_store.py self-test passed.")
