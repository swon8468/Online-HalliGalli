import { supabase } from './supabase'

export interface AccountProfile {
  id: string
  nickname: string
  friendTag: string
  avatarSeed: string
  createdAt: string
}

function client() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  return supabase
}

export async function getAccountProfile(): Promise<AccountProfile> {
  const { data: auth, error: authError } = await client().auth.getUser()
  if (authError || !auth.user) throw authError ?? new Error('로그인이 필요합니다.')
  const { data, error } = await client().from('profiles').select('id,nickname,friend_tag,avatar_seed,created_at').eq('id', auth.user.id).single()
  if (error) throw error
  return { id: data.id, nickname: data.nickname, friendTag: data.friend_tag, avatarSeed: data.avatar_seed, createdAt: data.created_at }
}

export async function updateAccountProfile(nickname: string, avatarSeed: string) {
  const { data: auth } = await client().auth.getUser()
  if (!auth.user) throw new Error('로그인이 필요합니다.')
  const { error } = await client().from('profiles').update({ nickname: nickname.trim(), avatar_seed: avatarSeed, updated_at: new Date().toISOString() }).eq('id', auth.user.id)
  if (error) throw error
  await client().auth.updateUser({ data: { ...auth.user.user_metadata, nickname: nickname.trim() } })
}

export async function changeAccountPassword(password: string) {
  const { error } = await client().auth.updateUser({ password })
  if (error) throw error
}

export async function deleteAccount(confirmation: string) {
  const { data, error } = await client().functions.invoke('delete-account', { body: { confirmation } })
  if (error || data?.error) throw new Error(data?.error ?? error?.message ?? '회원 탈퇴 실패')
}
