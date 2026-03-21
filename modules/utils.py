"""
utils.py — Standalone utility helpers for the face tracker pipeline.

No classes.  All functions are pure or operate on numpy arrays / cv2 frames.

Allowed imports: cv2, numpy, logging, pathlib, datetime.
"""

import logging
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Colour constants (BGR)
_GREEN  = (0, 255, 0)
_WHITE  = (255, 255, 255)
_GREY   = (180, 180, 180)
_YELLOW = (0, 255, 255)


# ---------------------------------------------------------------------------
# Frame annotation
# ---------------------------------------------------------------------------

def draw_overlay(
    frame: np.ndarray,
    tracks: list[dict],
    face_id_map: dict,
    active_count: int,
    unique_total: int,
    entry_line_y: float = 0.5,
    frame_id: int = 0,
) -> np.ndarray:
    """Annotate a video frame with tracking overlays and a live HUD.

    Draws a green bounding box and face-ID label for every active track,
    a top-left HUD showing visitor statistics, and a dashed yellow entry
    line at the configured vertical fraction of the frame.

    The original *frame* is never mutated — a copy is always made first.

    Args:
        frame: BGR video frame as a numpy array.
        tracks: List of track dicts, each with keys ``'tracker_id'`` (int),
            ``'bbox'`` ([x1, y1, x2, y2] ints), and ``'confidence'`` (float).
        face_id_map: Mapping of ``tracker_id`` → ``face_id`` string.
        active_count: Number of faces currently confirmed inside.
        unique_total: Total unique visitors seen (all time).
        entry_line_y: Fractional vertical position (0–1) of the entry line.
            Defaults to ``0.5``.
        frame_id: Current frame sequence number shown in the HUD.

    Returns:
        Annotated copy of *frame*.
    """
    out = frame.copy()
    h, w = out.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX

    # --- Per-track boxes and labels ------------------------------------------
    for track in tracks:
        tid  = track.get("tracker_id", -1)
        bbox = track.get("bbox", [0, 0, 0, 0])
        conf = track.get("confidence", 0.0)
        fid  = face_id_map.get(tid, "?")

        x1, y1, x2, y2 = bbox
        cv2.rectangle(out, (x1, y1), (x2, y2), _GREEN, 2)

        label = f"{fid} ({conf:.2f})"
        (lw, lh), baseline = cv2.getTextSize(label, font, 0.5, 1)
        label_y = max(y1 - 6, lh + 4)
        cv2.rectangle(out, (x1, label_y - lh - 4), (x1 + lw + 4, label_y + baseline), (0, 0, 0), cv2.FILLED)
        cv2.putText(out, label, (x1 + 2, label_y - 2), font, 0.5, _GREEN, 1, cv2.LINE_AA)

    # --- Top-left HUD --------------------------------------------------------
    hud_lines = [
        (f"Unique Visitors: {unique_total}", _WHITE),
        (f"Currently Inside: {active_count}", _WHITE),
        (f"Frame: {frame_id}", _GREY),
    ]
    for i, (text, colour) in enumerate(hud_lines):
        y_pos = 24 + i * 22
        cv2.putText(out, text, (10, y_pos), font, 0.6, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(out, text, (10, y_pos), font, 0.6, colour, 1, cv2.LINE_AA)

    # --- Dashed entry line ---------------------------------------------------
    line_y = int(entry_line_y * h)
    dash_len = 20
    gap_len  = 10
    x = 0
    while x < w:
        x_end = min(x + dash_len, w)
        cv2.line(out, (x, line_y), (x_end, line_y), _YELLOW, 2)
        x += dash_len + gap_len

    return out


# ---------------------------------------------------------------------------
# Timestamp helpers
# ---------------------------------------------------------------------------

def format_timestamp(dt: datetime | None = None) -> str:
    """Return an ISO-8601 timestamp string without microseconds.

    Args:
        dt: Datetime to format.  If ``None``, ``datetime.now()`` is used.

    Returns:
        String in the form ``'YYYY-MM-DDTHH:MM:SS'``.
    """
    if dt is None:
        dt = datetime.now()
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def compute_cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Return the cosine similarity between two 1-D vectors.

    Args:
        a: First vector as a numpy array.
        b: Second vector as a numpy array.

    Returns:
        Float in [-1, 1], or ``0.0`` if either vector has zero norm.
    """
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------

def ensure_dir(path: str | Path) -> None:
    """Create *path* (and all parents) if it does not already exist.

    Args:
        path: Directory path as a string or :class:`pathlib.Path`.
    """
    Path(path).mkdir(parents=True, exist_ok=True)
