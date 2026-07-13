import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY
const response = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
if (!response.ok) throw new Error(`개발 프로젝트 API 키 조회 실패 (${response.status})`)
const keys = await response.json()
const service = keys.find(key => key.name === 'service_role')?.api_key
if (!url || !anon || !service) throw new Error('개발 Supabase 설정이 필요합니다.')
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const email = 'account-delete-test@swonport.kr', initialPassword = 'AccountTest2026', changedPassword = 'AccountChanged2026'
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
let account = listed.data.users.find(user => user.email === email)
const authResult = account
  ? await admin.auth.admin.updateUserById(account.id, { password: initialPassword, email_confirm: true, ban_duration: 'none', user_metadata: { nickname: '계정테스트' } })
  : await admin.auth.admin.createUser({ email, password: initialPassword, email_confirm: true, user_metadata: { nickname: '계정테스트' } })
if (authResult.error) throw authResult.error
account = authResult.data.user
const resetProfile = await admin.from('profiles').update({ nickname: '계정테스트', friend_tag: `account#${account.id.replaceAll('-', '').slice(0, 8)}`, deleted_at: null, suspended_until: null, suspension_reason: null }).eq('id', account.id)
if (resetProfile.error) throw resetProfile.error

const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
let signed = await client.auth.signInWithPassword({ email, password: initialPassword })
if (signed.error) throw signed.error
let update = await client.from('profiles').update({ nickname: '계정수정테스트' }).eq('id', account.id)
if (update.error) throw update.error
const changed = await client.auth.updateUser({ password: changedPassword })
if (changed.error) throw changed.error
await client.auth.signOut()
signed = await client.auth.signInWithPassword({ email, password: changedPassword })
if (signed.error) throw signed.error

const invalidDelete = await client.functions.invoke('delete-account', { body: { confirmation: '잘못된 확인' } })
if (!invalidDelete.error) throw new Error('잘못된 탈퇴 확인값이 허용됨')
const deleted = await client.functions.invoke('delete-account', { body: { confirmation: '회원 탈퇴' } })
if (deleted.error || !deleted.data?.ok) throw deleted.error ?? new Error('회원 탈퇴 함수 실패')
const deletedProfile = await admin.from('profiles').select('nickname,deleted_at').eq('id', account.id).single()
if (deletedProfile.error || !deletedProfile.data.deleted_at || deletedProfile.data.nickname !== '탈퇴한 사용자') throw deletedProfile.error ?? new Error('프로필 탈퇴 상태 반영 실패')
await client.auth.signOut()
const denied = await client.auth.signInWithPassword({ email, password: changedPassword })
if (!denied.error) throw new Error('탈퇴 계정 재로그인이 허용됨')

console.log('verified profile update, password change, delete confirmation, soft deletion, auth ban, and deleted-account login rejection')
