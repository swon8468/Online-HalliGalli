import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const role = process.argv[2]
if (!['player', 'super_admin'].includes(role)) throw new Error('Usage: node scripts/set-admin-browser-test-role.mjs <player|super_admin>')
const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL
const response = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
if (!response.ok) throw new Error('개발 프로젝트 키 조회 실패')
const service = (await response.json()).find(key => key.name === 'service_role')?.api_key
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
const user = listed.data.users.find(item => item.email === 'lobby1@swonport.kr')
if (!user) throw new Error('브라우저 테스트 계정을 찾을 수 없습니다.')
const authUpdate = await admin.auth.admin.updateUserById(user.id, { app_metadata: { platform_role: role } })
if (authUpdate.error) throw authUpdate.error
const profileUpdate = await admin.from('profiles').update({ platform_role: role, deleted_at: null, suspended_until: null, suspension_reason: null }).eq('id', user.id)
if (profileUpdate.error) throw profileUpdate.error
console.log(`browser test role set to ${role}`)
