import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import AdminApp from './admin/AdminApp'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { isAdminHostname } from './lib/environment'
import './styles.css'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {isAdminHostname() ? <AdminApp /> : <App />}
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
