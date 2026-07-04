import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { installGlobalCrashHandler } from './utils/crashReporter'
import { trackEvent } from './utils/analytics'

// AQ-S4-002: auto-capture uncaught UI errors + rejections and upload them.
installGlobalCrashHandler()
// AQ-S4-003: record an anonymous app-open event.
trackEvent('app_open')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
