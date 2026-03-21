"""
face_embedder.py — InsightFace buffalo_l embedding wrapper.

Produces 512-dim float32 embeddings with optional CLAHE preprocessing
for improved accuracy under uneven or backlit lighting conditions.
"""

import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import cv2
import insightface
import numpy as np

from modules.config_loader import Config

logger = logging.getLogger(__name__)

_MIN_CROP_SIZE = 64  # crops smaller than 64×64 produce garbage embeddings


class FaceEmbedder:
    """InsightFace buffalo_l wrapper for face embedding and attribute extraction.

    Applies optional CLAHE preprocessing on the L channel (LAB colour space)
    before passing crops to the model, which significantly improves embedding
    quality for backlit and low-contrast faces.
    """

    def __init__(self, cfg: Config) -> None:
        """Initialise InsightFace app and CLAHE preprocessor.

        Args:
            cfg: Loaded Config dataclass instance.

        Note:
            buffalo_l auto-downloads ~300 MB on first run.
        """
        self.use_clahe = cfg.use_clahe
        ctx_id = 0 if cfg.device == "cuda" else -1

        logger.info(
            "EMBEDDER_DOWNLOADING buffalo_l model if not cached (~300MB first run)"
        )
        self.app = insightface.app.FaceAnalysis(name="buffalo_l")
        self.app.prepare(ctx_id=ctx_id, det_size=(320, 320))

        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))

        logger.info(
            "EMBEDDER_INIT model=buffalo_l device=%s clahe=%s",
            cfg.device,
            cfg.use_clahe,
        )

    def _apply_clahe(self, face_crop: np.ndarray) -> np.ndarray:
        """Apply CLAHE to the L channel of a BGR face crop.

        Converts BGR → LAB, enhances the L (luminance) channel only,
        then converts back to BGR.

        Args:
            face_crop: BGR face crop as numpy array.

        Returns:
            CLAHE-enhanced BGR image (same shape as input).
        """
        lab = cv2.cvtColor(face_crop, cv2.COLOR_BGR2LAB)
        l_ch, a_ch, b_ch = cv2.split(lab)
        l_ch = self.clahe.apply(l_ch)
        enhanced = cv2.merge((l_ch, a_ch, b_ch))
        return cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)

    def crop_face(
        self, frame: np.ndarray, bbox: list, padding: float = 0.25
    ) -> np.ndarray | None:
        """Extract a padded face crop from the frame.

        Args:
            frame: Full BGR video frame (not mutated).
            bbox: [x1, y1, x2, y2] bounding box in absolute pixel coords.
            padding: Fractional padding to add on each side (default 0.25 = 25%).

        Returns:
            Cropped numpy array, or None if the crop is smaller than 64×64.
        """
        x1, y1, x2, y2 = bbox
        h, w = frame.shape[:2]

        bw = x2 - x1
        bh = y2 - y1
        pad_x = int(bw * padding)
        pad_y = int(bh * padding)

        cx1 = max(x1 - pad_x, 0)
        cy1 = max(y1 - pad_y, 0)
        cx2 = min(x2 + pad_x, w)
        cy2 = min(y2 + pad_y, h)

        crop = frame[cy1:cy2, cx1:cx2].copy()

        if crop.shape[0] < _MIN_CROP_SIZE or crop.shape[1] < _MIN_CROP_SIZE:
            return None

        return crop

    def get_embedding(self, face_crop: np.ndarray) -> np.ndarray | None:
        """Compute a 512-dim embedding for a face crop.

        Args:
            face_crop: BGR face crop (at least 64×64).

        Returns:
            512-dim float32 numpy array, or None if InsightFace finds no face.
        """
        img = self._apply_clahe(face_crop) if self.use_clahe else face_crop.copy()

        # High-res crops confuse InsightFace's internal detector; resize to
        # standard face size so detection is reliable regardless of camera res.
        if img.shape[0] > 224 or img.shape[1] > 224:
            img = cv2.resize(img, (112, 112))

        t0 = time.perf_counter()
        faces = self.app.get(img)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        if not faces:
            return None

        embedding = faces[0].embedding.astype(np.float32)
        logger.info(
            "EMBEDDING_GENERATED shape=%d time_ms=%.1f", embedding.shape[0], elapsed_ms
        )
        return embedding

    def get_age_gender(
        self, face_crop: np.ndarray
    ) -> tuple[int | None, str | None]:
        """Estimate age and gender from a face crop.

        Args:
            face_crop: BGR face crop (at least 64×64).

        Returns:
            (age, gender) where gender is 'Male' or 'Female',
            or (None, None) if no face is detected.
        """
        img = self._apply_clahe(face_crop) if self.use_clahe else face_crop.copy()
        faces = self.app.get(img)

        if not faces:
            return None, None

        age = int(faces[0].age)
        gender = "Male" if faces[0].gender == 1 else "Female"
        return age, gender


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
    embedder = FaceEmbedder(cfg)
    dummy_crop = np.random.randint(0, 255, (112, 112, 3), dtype=np.uint8)
    emb = embedder.get_embedding(dummy_crop)
    if emb is not None:
        print(f"Embedding shape: {emb.shape}")
    else:
        print("No face in dummy crop (expected on random noise)")
    print("face_embedder.py self-test passed.")
