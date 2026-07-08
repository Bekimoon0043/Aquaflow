import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AppLicenseGate from './components/AppLicenseGate.jsx'
import { installGlobalCrashHandler } from './utils/crashReporter'
import { trackEvent } from './utils/analytics'

// AQ-S4-002: auto-capture uncaught UI errors + rejections and upload them.
installGlobalCrashHandler()
// AQ-S4-003: record an anonymous app-open event.
trackEvent('app_open')

// AF-PKG-ENABLE-LICENSE: the whole app is gated behind a valid machine-locked license.
// Until one is activated, AppLicenseGate renders the activation screen (machine ID + load
// license) instead of the studio.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppLicenseGate>
      <App />
    </AppLicenseGate>
  </React.StrictMode>
)
