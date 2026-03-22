"""
video_capture.py — Threaded frame reader for video files and RTSP streams.

IMPORTANT: For RTSP sources, ``os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"]``
is set in ``__init__`` *before* any ``cv2.VideoCapture`` call, as required by
OpenCV's FFMPEG backend.

Allowed imports: cv2, threading, os, time, logging, pathlib.
"""

import logging
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import cv2
import numpy as np

from modules.config_loader import Config
from modules.rtsp_stream import RTSPStream

logger = logging.getLogger(__name__)


class VideoCapture:
    """Thread-based video reader that keeps the most recent frame in memory.

    A background daemon thread continuously calls ``cap.read()``.  The main
    thread retrieves frames via :meth:`read` without ever blocking on I/O.
    For RTSP streams the reader automatically attempts reconnection on failure.
    """

    def __init__(self, cfg: Config) -> None:
        """Prepare the capture object.

        Sets the RTSP transport env-var if the source is RTSP.  Does NOT open
        the capture device — call :meth:`start` for that.

        Args:
            cfg: Loaded Config dataclass instance.
        """
        if cfg.source == "rtsp":
            # TCP is more stable than UDP on local networks and avoids
            # frame reordering that contributes to buffer lag.
            # Must be set before any cv2.VideoCapture call.
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
            logger.info("RTSP_TRANSPORT_SET rtsp_transport=tcp")

        self.source = cfg.source
        self.path   = cfg.video_path if cfg.source == "video" else cfg.rtsp_url

        self.frame: np.ndarray | None = None
        self.lock    = threading.Lock()
        self.running = False
        self._cap: cv2.VideoCapture | None = None
        self._thread: threading.Thread | None = None
        self._rtsp_stream: RTSPStream | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Open the capture source and start the background reader thread.

        For RTSP sources, delegates to RTSPStream which continuously grabs the
        latest frame and discards buffered ones, eliminating accumulation lag.
        For video files, uses the existing threaded cv2.VideoCapture reader.

        Raises:
            RuntimeError: If the capture device cannot be opened (video files only).
        """
        if self.source == "rtsp":
            self._rtsp_stream = RTSPStream(self.path).start()
            self.running = True
            logger.info(
                "CAPTURE_START source=rtsp path=%s via=RTSPStream connected=%s",
                self.path,
                self._rtsp_stream.is_connected,
            )
            return

        self._cap = cv2.VideoCapture(self.path, cv2.CAP_FFMPEG)
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        if not self._cap.isOpened():
            raise RuntimeError(f"Cannot open source: {self.path}")

        fps = self._cap.get(cv2.CAP_PROP_FPS) or 25.0
        width  = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        self.running = True
        self._thread = threading.Thread(
            target=self._reader, daemon=True, name="video-reader"
        )
        self._thread.start()

        logger.info(
            "CAPTURE_START source=%s path=%s fps=%.1f resolution=%dx%d",
            self.source,
            self.path,
            fps,
            width,
            height,
        )

    def stop(self) -> None:
        """Signal the reader thread to stop and release the capture device."""
        self.running = False
        if self._rtsp_stream is not None:
            self._rtsp_stream.stop()
        if self._cap is not None:
            self._cap.release()
        logger.info("CAPTURE_STOP source=%s", self.source)

    # ------------------------------------------------------------------
    # Background reader
    # ------------------------------------------------------------------

    def _reader(self) -> None:
        """Background thread: continuously reads frames from the capture device.

        For video files, sets ``self.running = False`` on EOF.
        For RTSP streams, attempts to reconnect with a 2-second delay on failure.
        """
        while self.running:
            ret, frame = self._cap.read()

            if ret:
                with self.lock:
                    self.frame = frame
            else:
                if self.source == "video":
                    logger.info("CAPTURE_EOF path=%s", self.path)
                    self.running = False
                else:
                    logger.warning(
                        "STREAM_RECONNECT attempt path=%s", self.path
                    )
                    time.sleep(2)
                    self._cap = cv2.VideoCapture(self.path, cv2.CAP_FFMPEG)

    # ------------------------------------------------------------------
    # Frame access
    # ------------------------------------------------------------------

    def read(self) -> np.ndarray | None:
        """Return a copy of the most recently captured frame.

        Returns:
            BGR numpy array, or ``None`` if no frame has been captured yet.
        """
        if self._rtsp_stream is not None:
            ret, frame = self._rtsp_stream.read()
            return frame if ret else None
        with self.lock:
            if self.frame is not None:
                return self.frame.copy()
            return None

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    def get_fps(self) -> float:
        """Return the capture source frame rate.

        Returns:
            Frames per second as a float. Falls back to 25.0 if unknown.
        """
        if self._cap is None:
            return 25.0
        return self._cap.get(cv2.CAP_PROP_FPS) or 25.0

    def get_resolution(self) -> tuple[int, int]:
        """Return the capture source resolution as ``(width, height)``.

        Returns:
            Tuple of (width, height) integers.
        """
        if self._cap is None:
            return (0, 0)
        return (
            int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        )

    def is_running(self) -> bool:
        """Return ``True`` while the reader thread is active.

        For RTSP sources, stays True even during reconnect attempts so the
        pipeline loop keeps running rather than exiting on transient drops.

        Returns:
            Boolean running state.
        """
        if self._rtsp_stream is not None:
            return self._rtsp_stream._running
        return self.running


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
    cap = VideoCapture(cfg)

    try:
        cap.start()
        time.sleep(1)
        frame = cap.read()
        if frame is not None:
            print(f"Frame shape: {frame.shape}")
        else:
            print("No frame yet (expected if sample.mp4 missing)")
        cap.stop()
    except RuntimeError as exc:
        print(f"Could not open source ({exc}) — expected if sample.mp4 missing")

    print("video_capture.py self-test passed.")
