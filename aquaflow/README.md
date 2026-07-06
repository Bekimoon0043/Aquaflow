# AquaFlow Studio

**Professional Multimedia Fountain Show Control Platform**

---

## Project Structure

```
aquaflow/
├── frontend/               # React + Vite UI
│   ├── .env.example
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── config.js               # Runtime API / WS endpoint selection
│       ├── store/
│       │   ├── showStore.js        # Zustand state management
│       │   └── showStoreActions.js
│       ├── hooks/
│       │   ├── useAutoSave.js
│       │   ├── useServerShowSync.js
│       │   └── useWebSocket.js
│       ├── components/
│       │   ├── TopBar.jsx
│       │   ├── StatusBar.jsx
│       │   ├── ConnectionBanner.jsx
│       │   ├── ShowBrowser.jsx
│       │   ├── timeline/Timeline.jsx
│       │   ├── nodes/NodeEditor.jsx
│       │   └── panels/
│       │       ├── DevicePanel.jsx
│       │       ├── InspectorPanel.jsx
│       │       ├── PreviewPanel.jsx
│       │       ├── AIPanel.jsx
│       │       ├── AudioPanel.jsx
│       │       ├── DeviceDiscoveryPanel.jsx
│       │       ├── PLCPanel.jsx
│       │       └── SchedulerPanel.jsx
│       ├── utils/
│       │   ├── runtimeSync.js
│       │   └── showFile.js
│       └── styles/globals.css
│
├── backend/                # Python FastAPI server
│   ├── main.py             # FastAPI app + WebSocket + health endpoint
│   ├── requirements.txt
│   ├── requirements-audio.txt
│   ├── ai/
│   │   └── choreography_engine.py
│   ├── audio/
│   │   └── audio_engine.py
│   ├── engine/
│   │   ├── show_engine.py
│   │   ├── device_manager.py
│   │   ├── network_scanner.py
│   │   └── protocol_bus.py
│   ├── plc/
│   │   └── plc_engine.py
│   ├── scheduler/
│   │   └── scheduler_engine.py
│   └── api/routes/
│       ├── shows.py
│       ├── devices.py
│       ├── ai_engine.py
│       ├── audio.py
│       ├── plc.py
│       ├── scheduler.py
│       └── protocols.py
│
├── install.cmd
├── start-backend.cmd
├── start-frontend.cmd
├── start-all.cmd
└── verify-install.cmd
```

---

## Current Module Status

| Module | Status |
|--------|--------|
| Show Design Studio UI | ✅ Complete |
| Node Editor | ✅ Complete |
| Timeline Sequencer with multi-select + marquee | ✅ Complete |
| Device Panel + Inspector | ✅ Complete |
| 3D Fountain Preview | ✅ Complete |
| AI Choreography Engine | ✅ Complete |
| Audio Upload / Analysis / Sync | ✅ Complete |
| Device Discovery / DMX Monitor / Hardware Test | ✅ Complete |
| PLC Panel | ✅ Complete |
| Scheduler Panel | ✅ Complete |
| Show file save / load browser | ✅ Complete |
| FastAPI backend + WebSocket runtime | ✅ Complete |
| Art-Net / Modbus integration layer | ✅ Complete |

---

## Quick Start (Windows)

### One-time install
```bat
install.cmd
```

### Start both services
```bat
start-all.cmd
```

### Or start them separately
```bat
start-backend.cmd
start-frontend.cmd
```

### Verification
```bat
verify-install.cmd
```

Notes:
- The backend runs on `http://localhost:8000`.
- The frontend usually starts on `http://localhost:3000`, but if that port is already occupied Vite will automatically move to `http://localhost:3001` or the next free port.
- The default frontend endpoint mapping is stored in `frontend/.env.local` when missing.

---

## Manual Start Commands

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend

**Production / bench / operator (default — NO auto-reload):**
```bash
cd backend
py -m pip install -r requirements.txt
python main.py            # production mode: reload OFF, no file watchers (AF-HUB-000B)
```

> Do **not** run the backend with `--reload` in production/bench. uvicorn's reloader
> spawns a file-watching supervisor that can restart the process mid-show, dropping output
> and re-initialising hardware. Auto-reload is development-only:

**Developer mode only (auto-reload):**
```bash
cd backend
AQUAFLOW_DEV=1 python main.py     # dev: auto-reload + watchers (never on the bench)
```

---

## Health and Smoke Tests

- Backend health: `http://localhost:8000/api/health`
- Frontend: `http://localhost:3000` or the alternate Vite localhost URL shown in the terminal
- AI moods: `http://localhost:8000/api/ai/moods`
- Audio capabilities: `http://localhost:8000/api/audio/capabilities`

---

## Architecture

```
React Frontend (Vite)
        │  HTTP REST + WebSocket
        ▼
FastAPI Backend (Python)
        │
        ├── Show Engine (100Hz deterministic loop)
        ├── Device Manager (health monitoring)
        ├── Audio Analysis Engine
        ├── AI Choreography Engine
        ├── PLC Engine
        ├── Scheduler Engine
        └── Protocol Bus
                ├── Art-Net UDP driver
                ├── Modbus TCP driver
                ├── MQTT driver
                └── future protocol adapters
```
