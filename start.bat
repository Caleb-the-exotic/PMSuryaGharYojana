@echo off
title SuryaSys - Launching Application...
cd /d "%~dp0"

echo ============================================================
echo           PM Surya Ghar Yojana - Solar Analyzer
echo ============================================================
echo.
echo [1/3] Checking environment...

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python was not found in PATH!
    echo Please make sure Python is installed and added to PATH.
    pause
    exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm was not found in PATH!
    echo Please make sure Node.js is installed and added to PATH.
    pause
    exit /b 1
)

echo [2/3] Starting Backend (FastAPI on Port 8000)...
start "SuryaSys Backend (FastAPI)" cmd /k "title SuryaSys Backend && cd /d "%~dp0" && if exist venv\Scripts\activate.bat (call venv\Scripts\activate.bat) else (if exist .venv\Scripts\activate.bat (call .venv\Scripts\activate.bat)) && python main.py"

echo [3/3] Starting Frontend (Vite React on Port 5173)...
start "SuryaSys Frontend (Vite)" cmd /k "title SuryaSys Frontend && cd /d "%~dp0" && npm run dev"

echo.
echo ============================================================
echo  [SUCCESS] Application launched in separate terminal windows!
echo.
echo    - Frontend Web App:  http://localhost:5173
echo    - Backend API Docs:  http://localhost:8000/api/docs
echo    - Backend API Root:  http://localhost:8000
echo ============================================================
echo.
echo Opening browser to http://localhost:5173 in 4 seconds...
timeout /t 4 /nobreak >nul
start http://localhost:5173

exit
