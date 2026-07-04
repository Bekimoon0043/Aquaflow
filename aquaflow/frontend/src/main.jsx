import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { installGlobalCrashHandler } from './utils/crashReporter'

// AQ-S4-002: auto-capture uncaught UI errors + rejections and upload them.
installGlobalCrashHandler()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
