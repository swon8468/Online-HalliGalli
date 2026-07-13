import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const action = process.argv[2]
if (!['add', 'remove'].includes(action)) throw new Error('Usage: node scripts/set-space-browser-test-membership.mjs <add|remove>')
const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [] }))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL
const response = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
if (!response.ok) throw new Error('개발 프로젝트 키 조회 실패')
const service = (await response.json()).find(key => key.name === 'service_role')?.api_key
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (users.error) throw users.error
const user = users.data.users.find(item => item.email === 'lobby1@swonport.kr')
const space = (await admin.from('spaces').select('id').eq('slug', 'automation-organization').single()).data
if (!user || !space) throw new Error('브라우저 테스트 계정 또는 스페이스가 없습니다.')
const result = action === 'add'
  ? await admin.from('space_members').upsert({ space_id: space.id, user_id: user.id, role: 'manager', invited_by: user.id, student_or_employee_id: 'BROWSER-001' }, { onConflict: 'space_id,user_id' })
  : await admin.from('space_members').delete().eq('space_id', space.id).eq('user_id', user.id)
if (result.error) throw result.error
console.log(`browser space membership ${action === 'add' ? 'added' : 'removed'}`)
