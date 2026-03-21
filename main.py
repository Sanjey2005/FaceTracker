"""
main.py — CLI entry point for the Intelligent Face Tracker.

Parses arguments, loads configuration, applies CLI overrides, and
hands off to Pipeline.  No business logic lives here.
"""

import argparse

from modules.config_loader import load_config
from pipeline import Pipeline


def main() -> None:
    """Parse CLI arguments, build config, and run the pipeline."""
    parser = argparse.ArgumentParser(description="Intelligent Face Tracker")
    parser.add_argument(
        "--source",
        choices=["video", "rtsp"],
        help="Override config source type",
    )
    parser.add_argument("--path", help="Override video file path")
    parser.add_argument("--url", help="Override RTSP stream URL")
    parser.add_argument(
        "--config", default="config.json", help="Path to config file"
    )
    args = parser.parse_args()

    cfg = load_config(args.config)

    # CLI overrides (dataclass fields are mutable)
    if args.source:
        cfg.source = args.source
    if args.path:
        cfg.video_path = args.path
    if args.url:
        cfg.rtsp_url = args.url

    pipeline = Pipeline(cfg)
    pipeline.run()


if __name__ == "__main__":
    main()
