export const appEnvironment = import.meta.env.VITE_APP_ENV ?? 'development'
export const isDevelopment = appEnvironment === 'development'
export const phoneAuthEnabled = import.meta.env.VITE_PHONE_AUTH_ENABLED === 'true'

export const appUrls = {
  public: import.meta.env.VITE_PUBLIC_APP_URL ?? 'http://127.0.0.1:43127',
  admin: import.meta.env.VITE_ADMIN_APP_URL ?? 'http://127.0.0.1:43127/admin',
}

export function isAdminHostname(hostname = window.location.hostname) {
  return hostname === 'admin.haligali.swonport.kr'
    || hostname === 'develop.admin.haligali.swonport.kr'
}
