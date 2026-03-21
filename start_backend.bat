@echo off
REM Start backend server with proper Python path
REM This script ensures the backend starts reliably

cd /d "D:\CodingWorks\ProteomicsVizWebApp\backend"

echo Starting Proteomics Viz Backend...
echo Using Python: D:\Software\Python\python.exe

REM Kill any existing uvicorn processes
taskkill /F /IM python.exe 2>nul

REM Start uvicorn with timeout protection
"D:\Software\Python\python.exe" -m uvicorn app.main:app --reload --port 8000 --log-level info

REM If it fails, pause so user can see error
if errorlevel 1 (
    echo.
    echo Backend failed to start!
    pause
)
