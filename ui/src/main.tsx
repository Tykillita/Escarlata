import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/oswald/300.css'
import '@fontsource/oswald/400.css'
import './index.css'
import App from './App.tsx'

// Service worker: requerido para Web Push (y para que iOS trate la PWA como app)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* dev sin https, ok */ });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
