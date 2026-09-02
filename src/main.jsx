import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'
import { applyDesktopRuntimeClasses } from './utils/desktopRuntime'

// Initialize i18n
import './i18n/config.js'

const desktopRuntime = applyDesktopRuntimeClasses()

// Refresh service worker registration from bundled code so CSP can block inline scripts.
if (!desktopRuntime.isDesktopShell && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then(async registrations => {
      await Promise.all(registrations.map(registration => registration.unregister()));
      const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      await registration.update();
      console.log('SW registered: ', registration);
    }).catch(err => {
      console.warn('Service worker refresh failed:', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
