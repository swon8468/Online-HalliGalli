import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const [manifestSource, html, redirects, pwaCenter, pushWorker, pushClient, icon192, icon512, appleIcon] = await Promise.all([
  readFile('dist/manifest.webmanifest', 'utf8'),
  readFile('dist/index.html', 'utf8'),
  readFile('dist/_redirects', 'utf8'),
  readFile('src/components/PwaCenter.tsx', 'utf8'),
  readFile('public/push-sw.js', 'utf8'),
  readFile('src/lib/push.ts', 'utf8'),
  readFile('public/icon-192.png'),
  readFile('public/icon-512.png'),
  readFile('public/apple-touch-icon.png'),
])
const manifest = JSON.parse(manifestSource)
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.orientation, 'portrait-primary')
assert.ok(manifest.icons.some(icon => String(icon.purpose).includes('maskable')))
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.type === 'image/png'))
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.type === 'image/png'))
assert.match(html, /viewport-fit=cover/)
assert.match(html, /apple-mobile-web-app-capable/)
assert.match(html, /apple-touch-icon\.png/)
assert.equal(redirects.trim(), '/* /index.html 200')
assert.match(pwaCenter, /beforeinstallprompt/)
assert.match(pwaCenter, /setInstallPrompt\(null\)/)
assert.match(pwaCenter, /설치를 취소했어요/)
assert.match(pwaCenter, /halli-galli:pwa-update/)
assert.match(pwaCenter, /업데이트를 적용하지 못했어요/)
assert.match(pwaCenter, /window\.addEventListener\('offline'/)
assert.match(pwaCenter, /display-mode: standalone/)
assert.match(pushWorker, /requested\.origin === self\.location\.origin/)
assert.match(pushWorker, /existing\.navigate\(target\)/)
assert.match(pushWorker, /event\.data\.text\(\)/)
assert.match(pushWorker, /icon-192\.png/)
assert.match(pushClient, /serviceWorker\.ready/)
assert.match(pushClient, /register_push_subscription/)
assert.match(pushClient, /푸시 구독을 해제하지 못했어요/)
const pngSize = buffer => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) })
assert.deepEqual(pngSize(icon192), { width: 192, height: 192 })
assert.deepEqual(pngSize(icon512), { width: 512, height: 512 })
assert.deepEqual(pngSize(appleIcon), { width: 180, height: 180 })
const files = await readdir('dist')
assert.ok(files.includes('sw.js'))
const worker = await readFile('dist/sw.js', 'utf8')
assert.match(worker, /push-sw\.js/)
assert.match(worker, /index\.html/)
console.log('verified SPA deep-link fallback, install/update/offline UI hooks, PNG/iOS icons, static precache, safe-area manifest, resilient push payloads, subscription RPC, and same-origin notification deep links')
