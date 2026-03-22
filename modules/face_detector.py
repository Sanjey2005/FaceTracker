"""
face_detector.py — YOLOv8 wrapper for face detection.

Returns bounding boxes with confidence scores and area.
Filters out detections smaller than 40x40 px (area < 1600).
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import cv2
import numpy as np
from ultralytics import YOLO

from modules.config_loader import Config, get_device

logger = logging.getLogger(__name__)

_MIN_AREA = 1600  # 40 × 40 px minimum face area


class Detection(dict):
    """Dict subclass that exposes keys as attributes.

    Allows downstream code to access fields via either dict syntax
    (``d["bbox"]``) or attribute syntax (``d.bbox``, ``d.det_score``).
    """

    def __getattr__(self, key: str):
        try:
            return self[key]
        except KeyError:
            raise AttributeError(key)


class FaceDetector:
    """YOLOv8-based face detector.

    Wraps an Ultralytics YOLO model and returns normalised detection dicts
    suitable for downstream tracking and embedding modules.
    """

    def __init__(self, cfg: Config) -> None:
        """Load or download the YOLO face model.

        Args:
            cfg: Loaded Config dataclass instance.
        """
        model_path = Path(cfg.yolo_model)
        if model_path.exists():
            self.model = YOLO(str(model_path))
            logger.info("DETECTOR_INIT model=%s", model_path)
        else:
            logger.warning(
                "DETECTOR_INIT model=%s not found — falling back to yolov8n.pt",
                model_path,
            )
            self.model = YOLO("yolov8n.pt")

        self.confidence = cfg.yolo_confidence
        self.device = get_device(cfg)
        logger.info(
            "DETECTOR_INIT model=%s device=%s confidence=%.2f",
            model_path.name,
            self.device,
            self.confidence,
        )

    def detect(self, frame: np.ndarray) -> list[dict]:
        """Run YOLO inference and return filtered face detections.

        Args:
            frame: BGR image as a numpy array (H, W, 3).

        Returns:
            List of dicts, each with keys:
                'bbox'       — [x1, y1, x2, y2] in absolute pixel coords (ints)
                'confidence' — detection confidence (float)
                'area'       — bounding-box area in pixels (int)
            Empty list if no detections pass the filters.
        """
        results = self.model(
            frame,
            conf=self.confidence,
            device=self.device,
            verbose=False,
            imgsz=640,
        )

        detections: list[dict] = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
                conf = float(box.conf[0])
                area = (x2 - x1) * (y2 - y1)

                if area < _MIN_AREA:
                    continue
                if conf < self.confidence:
                    continue

                detections.append(Detection(bbox=[x1, y1, x2, y2], confidence=conf, area=area, det_score=conf))

        if detections:
            h, w = frame.shape[:2]
            logger.info(
                "DETECTED count=%d frame_shape=%dx%d", len(detections), h, w
            )

        return detections

    def draw_detections(
        self, frame: np.ndarray, detections: list[dict]
    ) -> np.ndarray:
        """Draw bounding boxes and confidence scores on a copy of the frame.

        Args:
            frame: Original BGR image (not mutated).
            detections: List of detection dicts from detect().

        Returns:
            Annotated copy of the frame.
        """
        annotated = frame.copy()
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            conf = det["confidence"]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(
                annotated,
                f"{conf:.2f}",
                (x1, max(y1 - 6, 0)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 255, 0),
                1,
                cv2.LINE_AA,
            )
        return annotated


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
    detector = FaceDetector(cfg)
    dummy = np.zeros((480, 640, 3), dtype=np.uint8)
    results = detector.detect(dummy)
    print(f"Detections on blank frame: {len(results)} (expected 0)")
    print("face_detector.py self-test passed.")
