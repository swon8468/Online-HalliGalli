import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const mode = process.argv[2] ?? 'preview'
if (!['preview', 'cleanup-test-assets'].includes(mode)) throw new Error('사용법: node scripts/audit-card-assets.mjs <preview|cleanup-test-assets>')
const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
if (env.VITE_APP_ENV !== 'development') throw new Error('개발 환경에서만 카드 파일을 감사할 수 있습니다.')
const url = env.VITE_SUPABASE_URL
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
if (!url || !accessToken) throw new Error('개발 Supabase 설정이 필요합니다.')
const projectRef = new URL(url).hostname.split('.')[0]
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${accessToken}` } })
if (!response.ok) throw new Error(`개발 프로젝트 키 조회 실패 (${response.status})`)
const serviceEntry = (await response.json()).find(key => key.name === 'service_role')
const service = serviceEntry?.api_key ?? serviceEntry?.value
if (!service) throw new Error('개발 service role 키를 찾지 못했습니다.')
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

const sets = await admin.from('card_sets').select('id')
if (sets.error) throw sets.error
const activeIds = new Set(sets.data.map(set => set.id))
const root = await admin.storage.from('card-assets').list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
if (root.error) throw root.error
const folders = []
for (const entry of root.data) {
  const nested = await admin.storage.from('card-assets').list(entry.name, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  if (nested.error) throw nested.error
  folders.push({
    folder: entry.name,
    activeCardSet: activeIds.has(entry.name),
    files: nested.data.filter(item => item.id).map(item => item.name),
  })
}
const orphanFolders = folders.filter(folder => !folder.activeCardSet)
console.log(JSON.stringify({
  projectRef,
  mode,
  activeCardSets: activeIds.size,
  folders: folders.length,
  orphanFolders,
}))

if (mode === 'cleanup-test-assets') {
  if (process.env.TEST_ASSET_CLEANUP !== 'DELETE_ORPHAN_TEST_CARD_ASSETS') {
    throw new Error('테스트 파일을 정리하려면 TEST_ASSET_CLEANUP=DELETE_ORPHAN_TEST_CARD_ASSETS가 필요합니다.')
  }
  const unsafe = orphanFolders.flatMap(folder => folder.files).filter(name => !/^test-\d+\.png$/.test(name))
  if (unsafe.length) throw new Error(`자동 테스트 패턴이 아닌 orphan 파일 ${unsafe.length}개가 있어 정리를 중단했습니다.`)
  const paths = orphanFolders.flatMap(folder => folder.files.map(name => `${folder.folder}/${name}`))
  if (paths.length) {
    const removed = await admin.storage.from('card-assets').remove(paths)
    if (removed.error) throw removed.error
  }
  for (const folder of orphanFolders) {
    const remaining = await admin.storage.from('card-assets').list(folder.folder, { limit: 1000 })
    if (remaining.error) throw remaining.error
    if (remaining.data.some(item => item.id && /^test-\d+\.png$/.test(item.name))) throw new Error('테스트 카드 파일이 정리 후에도 남았습니다.')
  }
  console.log(JSON.stringify({ cleanedTestAssets: paths.length, remainingTestAssets: 0 }))
}
