@echo off
setlocal
cd /d "%~dp0backend"
if exist ".venv\Scripts\python.exe" (
  call ".venv\Scripts\python.exe" -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
) else (
  py -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
)
endlocal
