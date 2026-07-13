import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import AdminApp from './admin/AdminApp'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { isAdminHostname } from './lib/environment'
import AppErrorBoundary from './components/AppErrorBoundary'
import './styles.css'

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { window.__halliGalliUpdateSW = updateSW; window.dispatchEvent(new Event('halli-galli:pwa-update')) },
  onOfflineReady() { window.dispatchEvent(new Event('halli-galli:pwa-offline-ready')) },
})
window.__halliGalliUpdateSW = updateSW

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          {isAdminHostname() ? <AdminApp /> : <App />}
        </AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
