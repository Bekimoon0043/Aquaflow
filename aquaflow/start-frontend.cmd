@echo off
setlocal
cd /d "%~dp0frontend"
if not exist ".env.local" (
  > ".env.local" echo VITE_API_BASE_URL=http://localhost:8000/api
  >> ".env.local" echo VITE_WS_URL=ws://localhost:8000/ws
)
echo Starting frontend. If port 3000 is busy, use the alternate localhost URL printed by Vite.
call npm run dev
endlocal
