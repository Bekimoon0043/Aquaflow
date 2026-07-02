@echo off
setlocal
cd /d "%~dp0"
echo ======================================
echo AquaFlow Studio - Verification
echo ======================================

echo [1/3] Frontend production build...
call npm --prefix frontend run build
if %errorlevel% neq 0 exit /b 1

echo [2/3] Backend syntax check...
cd backend
if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"
python verify_backend_syntax.py
if %errorlevel% neq 0 exit /b 1
cd ..

echo [3/3] Manual smoke test URLs...
echo   Backend health: http://localhost:8000/api/health
echo   Frontend: http://localhost:3000 ^(or the next Vite port, such as http://localhost:3001^)
echo Verification complete.
endlocal
