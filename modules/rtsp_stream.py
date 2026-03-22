"""
rtsp_stream.py — Low-latency RTSP frame grabber with automatic reconnect.

A background daemon thread continuously grabs the latest frame, discarding
unprocessed frames so the pipeline always sees the most recent image with
zero buffer lag.  For local video files use cv2.VideoCapture directly.
"""

import cv2
import threading
import time


class RTSPStream:
    """
    Continuously grabs the latest frame from an RTSP stream in a
    background thread, discarding unprocessed frames so the pipeline
    always gets the most recent frame with zero buffer lag.
    """

    def __init__(self, source, reconnect_delay=5):
        self.source = source
        self.reconnect_delay = reconnect_delay
        self._frame = None
        self._lock = threading.Lock()
        self._running = False
        self._connected = False
        self._thread = None
        self._cap = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._grab_loop, daemon=True)
        self._thread.start()
        # Wait up to 10s for first frame
        for _ in range(100):
            if self._frame is not None:
                break
            time.sleep(0.1)
        return self

    def _grab_loop(self):
        while self._running:
            # Open connection with low-latency flags
            self._cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
            # Set to lowest possible buffer size
            self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            # Use TCP for RTSP (more stable than UDP on local networks)
            if isinstance(self.source, str) and self.source.startswith('rtsp'):
                self._cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'H264'))

            if not self._cap.isOpened():
                self._connected = False
                time.sleep(self.reconnect_delay)
                continue

            self._connected = True
            consecutive_failures = 0

            while self._running:
                ret, frame = self._cap.read()
                if not ret:
                    consecutive_failures += 1
                    if consecutive_failures > 10:
                        # Stream dropped — reconnect
                        self._connected = False
                        break
                    time.sleep(0.01)
                    continue

                consecutive_failures = 0
                with self._lock:
                    self._frame = frame  # Always overwrite with latest

            self._cap.release()
            if self._running:
                time.sleep(self.reconnect_delay)  # Wait before reconnect

    def read(self):
        """Returns (True, latest_frame) or (False, None) if no frame yet."""
        with self._lock:
            if self._frame is None:
                return False, None
            return True, self._frame.copy()

    @property
    def is_connected(self):
        return self._connected

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
        if self._cap:
            self._cap.release()
