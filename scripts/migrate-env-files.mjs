import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const environments = ['development', 'production']
const publicKeys = new Set([
  'VITE_APP_ENV',
  'VITE_PUBLIC_APP_URL',
  'VITE_ADMIN_APP_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_VAPID_PUBLIC_KEY',
])

function readEnv(path) {
  if (!existsSync(path)) return new Map()
  return new Map(readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const separator = line.indexOf('=')
    return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
  }))
}

function writeEnv(path, values) {
  writeFileSync(path, `${Array.from(values.entries()).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 })
}

for (const environment of environments) {
  const examplePath = `.env.${environment}.example`
  const localPath = `.env.${environment}.local`
  const targetPath = `.env.${environment}`
  const source = readEnv(examplePath)
  const local = readEnv(localPath)
  const target = readEnv(targetPath)

  for (const [key, value] of source) if (value && !value.includes('your-')) target.set(key, value)
  for (const [key, value] of local) if (value && !target.has(key)) target.set(key, value)
  if (target.has('VITE_SUPABASE_ACCESS_TOKEN')) {
    target.set('SUPABASE_ACCESS_TOKEN', target.get('VITE_SUPABASE_ACCESS_TOKEN'))
    target.delete('VITE_SUPABASE_ACCESS_TOKEN')
  }
  writeEnv(targetPath, target)

  const template = new Map()
  for (const key of publicKeys) {
    const value = key === 'VITE_APP_ENV' ? environment
      : key === 'VITE_PUBLIC_APP_URL' ? (environment === 'development' ? 'https://develop.haligali.swonport.kr' : 'https://haligali.swonport.kr')
      : key === 'VITE_ADMIN_APP_URL' ? (environment === 'development' ? 'https://develop.admin.haligali.swonport.kr' : 'https://admin.haligali.swonport.kr')
      : `your-${environment}-${key.toLowerCase().replaceAll('_', '-')}`
    template.set(key, value)
  }
  writeEnv(examplePath, template)
  console.log(`${environment}: migrated ${target.size} values; template sanitized`)
}
