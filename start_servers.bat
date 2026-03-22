@echo off
title FaceTracker Servers Launcher

echo Starting FastAPI Backend...
start /B cmd /c "python -m uvicorn api.main:app --reload --port 8000"

echo Starting React Frontend...
start /B cmd /c "cd dashboard && npm run dev"

echo.
echo =======================================================
echo Both servers are now running smoothly in the background!
echo.
echo * KEEP THIS SINGLE WINDOW OPEN to keep servers online.
echo * Simply close this terminal window to stop everything.
echo =======================================================
echo.
pause
