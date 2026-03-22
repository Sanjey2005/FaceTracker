"""
config_loader.py — Load, validate, and expose config.json as a typed Config dataclass.

Stdlib only: json, pathlib, dataclasses, logging.
No third-party imports.
"""

import json
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class Config:
    """Typed representation of config.json. All modules receive this object."""

    source: str
    video_path: str
    rtsp_url: str
    detection_skip_frames: int
    embedding_skip_frames: int
    similarity_threshold: float
    embedding_quality_threshold: float
    min_track_frames: int
    tracker_max_age: int
    max_lost_frames: int
    entry_line_y: float
    crowd_threshold: int
    privacy_mode: bool
    db_path: str
    faiss_index_path: str
    log_dir: str
    yolo_model: str
    yolo_confidence: float
    device: str
    camera_id: str
    use_clahe: bool
    dashboard_port: int
    database_url: str


def load_config(path: str = "config.json") -> Config:
    """Read config.json, validate all fields, create required directories, and return a Config.

    Args:
        path: Path to the JSON config file. Defaults to 'config.json'.

    Returns:
        A fully validated Config dataclass instance.

    Raises:
        FileNotFoundError: If the config file does not exist.
        ValueError: If any field fails validation, with the field name in the message.
    """
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path.resolve()}")

    with config_path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    # --- Validation ---
    if raw.get("source") not in ("video", "rtsp"):
        raise ValueError(
            f"source must be 'video' or 'rtsp', got: {raw.get('source')!r}"
        )

    sim = raw.get("similarity_threshold")
    if not isinstance(sim, (int, float)) or not (0.0 <= float(sim) <= 1.0):
        raise ValueError(
            f"similarity_threshold must be between 0.0 and 1.0, got: {sim!r}"
        )

    skip = raw.get("detection_skip_frames")
    if not isinstance(skip, int) or skip < 1:
        raise ValueError(
            f"detection_skip_frames must be an integer >= 1, got: {skip!r}"
        )

    # --- Directory creation ---
    log_dir = Path(raw["log_dir"])
    for d in (log_dir, log_dir / "entries", log_dir / "exits", Path("data"), Path("models")):
        d.mkdir(parents=True, exist_ok=True)

    cfg = Config(
        source=str(raw["source"]),
        video_path=str(raw["video_path"]),
        rtsp_url=str(raw["rtsp_url"]),
        detection_skip_frames=int(raw["detection_skip_frames"]),
        embedding_skip_frames=int(raw["embedding_skip_frames"]),
        similarity_threshold=float(raw["similarity_threshold"]),
        embedding_quality_threshold=float(raw.get("embedding_quality_threshold", 0.85)),
        min_track_frames=int(raw["min_track_frames"]),
        tracker_max_age=int(raw["tracker_max_age"]),
        max_lost_frames=int(raw["max_lost_frames"]),
        entry_line_y=float(raw["entry_line_y"]),
        crowd_threshold=int(raw["crowd_threshold"]),
        privacy_mode=bool(raw["privacy_mode"]),
        db_path=str(raw["db_path"]),
        faiss_index_path=str(raw["faiss_index_path"]),
        log_dir=str(raw["log_dir"]),
        yolo_model=str(raw["yolo_model"]),
        yolo_confidence=float(raw["yolo_confidence"]),
        device=str(raw["device"]),
        camera_id=str(raw["camera_id"]),
        use_clahe=bool(raw["use_clahe"]),
        dashboard_port=int(raw["dashboard_port"]),
        database_url=str(raw.get("database_url", "")),
    )

    logger.info(
        "CONFIG_LOADED source=%s device=%s detection_skip_frames=%d",
        cfg.source,
        cfg.device,
        cfg.detection_skip_frames,
    )
    return cfg


def get_device(cfg: Config) -> str:
    """Resolve the compute device, falling back to CPU if CUDA is unavailable.

    Args:
        cfg: Loaded Config instance.

    Returns:
        'cuda' if cfg.device is 'cuda' and CUDA is available, else 'cpu'.
    """
    if cfg.device == "cuda":
        try:
            import torch  # imported here to keep this module stdlib-only at module level

            if torch.cuda.is_available():
                return "cuda"
            logger.warning(
                "DEVICE_FALLBACK cfg.device=cuda but CUDA not available, using cpu"
            )
        except ImportError:
            logger.warning(
                "DEVICE_FALLBACK torch not installed, cannot check CUDA — using cpu"
            )
    return "cpu"


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(module)s | %(message)s",
    )
    cfg = load_config()
    print(cfg)
