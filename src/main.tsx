import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { isAdminHostname } from './lib/environment'
import AppErrorBoundary from './components/AppErrorBoundary'
import E2ECrashProbe from './components/E2ECrashProbe'
import RouteLoading from './components/RouteLoading'
import './styles.css'

const AdminApp = lazy(() => import('./admin/AdminApp'))

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { window.__halliGalliUpdateSW = updateSW; window.dispatchEvent(new Event('halli-galli:pwa-update')) },
  onOfflineReady() { window.dispatchEvent(new Event('halli-galli:pwa-offline-ready')) },
})
window.__halliGalliUpdateSW = updateSW

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <E2ECrashProbe>
        <BrowserRouter>
          <AuthProvider>
            {isAdminHostname() ? <Suspense fallback={<RouteLoading />}><AdminApp /></Suspense> : <App />}
          </AuthProvider>
        </BrowserRouter>
      </E2ECrashProbe>
    </AppErrorBoundary>
  </StrictMode>,
)
