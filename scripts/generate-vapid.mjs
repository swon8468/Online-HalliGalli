import { createECDH, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const environments = ['development', 'production']
const force = process.argv.includes('--force')

function readEnv(path) {
  if (!existsSync(path)) return new Map()
  return new Map(readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const separator = line.indexOf('=')
    return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
  }))
}

function writeEnv(path, values) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${Array.from(values.entries()).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 })
}

for (const environment of environments) {
  const clientPath = `.env.${environment}`
  const serverPath = `supabase/.env.${environment}.local`
  const client = readEnv(clientPath)
  const server = readEnv(serverPath)
  const adminOrigin = environment === 'development' ? 'https://develop.admin.haligali.swonport.kr' : 'https://admin.haligali.swonport.kr'
  server.set('ALLOWED_ORIGINS', environment === 'development' ? `${adminOrigin},http://127.0.0.1:43127` : adminOrigin)

  if (!force && client.has('VITE_VAPID_PUBLIC_KEY') && server.has('VAPID_PRIVATE_KEY') && server.has('BOOTSTRAP_SECRET')) {
    writeEnv(serverPath, server)
    console.log(`${environment}: existing secrets preserved`)
    continue
  }

  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const publicKey = ecdh.getPublicKey().toString('base64url')
  const privateKey = ecdh.getPrivateKey().toString('base64url')
  const bootstrapSecret = randomBytes(32).toString('base64url')

  client.set('VITE_VAPID_PUBLIC_KEY', publicKey)
  server.set('VAPID_PUBLIC_KEY', publicKey)
  server.set('VAPID_PRIVATE_KEY', privateKey)
  server.set('VAPID_SUBJECT', 'mailto:admin@swonport.kr')
  server.set('BOOTSTRAP_SECRET', bootstrapSecret)
  writeEnv(clientPath, client)
  writeEnv(serverPath, server)

  const fingerprint = createHash('sha256').update(publicKey).digest('hex').slice(0, 12)
  console.log(`${environment}: generated (${fingerprint})`)
}
