@echo off
setlocal
cd /d "%~dp0"
echo ======================================
echo AquaFlow Studio - Windows CMD Install
echo ======================================

where py >nul 2>&1
if %errorlevel% neq 0 (
  echo Python launcher 'py' was not found. Install Python 3.11+ and try again.
  exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
  echo npm was not found. Install Node.js 20+ and try again.
  exit /b 1
)

echo [1/5] Installing frontend dependencies...
cd frontend
call npm install
if %errorlevel% neq 0 exit /b 1

echo [2/5] Building frontend...
call npm run build
if %errorlevel% neq 0 exit /b 1
if not exist ".env.local" (
  > ".env.local" echo VITE_API_BASE_URL=http://localhost:8000/api
  >> ".env.local" echo VITE_WS_URL=ws://localhost:8000/ws
)
cd ..

echo [3/5] Creating backend virtual environment...
cd backend
if not exist ".venv" call py -3 -m venv .venv
if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"

echo [4/5] Installing backend dependencies...
python -m pip install --upgrade pip setuptools wheel --default-timeout 120 --retries 10
pip install --default-timeout 120 --retries 10 --no-cache-dir -r requirements.txt
if %errorlevel% neq 0 (
  echo Core backend dependency install failed.
  echo Retry manually with: pip install --default-timeout 120 --retries 10 --no-cache-dir -r requirements.txt
  exit /b 1
)

echo [5/5] Verifying backend syntax...
python verify_backend_syntax.py
if %errorlevel% neq 0 (
  echo Backend syntax verification failed.
  exit /b 1
)
cd ..

echo.
echo Installation complete.
echo Frontend default API endpoints were written to frontend\.env.local if it was missing.
echo Use start-backend.cmd and start-frontend.cmd, or start-all.cmd.
echo If Vite says port 3000 is busy, open the alternate localhost URL it prints.
endlocal
