import { supabase } from '../lib/supabase'

export interface AdminStats {
  users: number
  activeRooms: number
  activePlayers: number
  activeSpaces: number
  moderationQueue: number
}

export interface AdminUserRow {
  id: string
  nickname: string
  friendTag: string
  status: '정상' | '정지' | '탈퇴'
  method: string
  joinedAt: string
}

export interface AdminRoomRow {
  id: string
  code: string
  type: string
  players: number
  capacity: number
  status: string
}

export interface AdminCardSetRow {
  id: string
  name: string
  scope: string
  status: string
  version: number
}

export interface AdminSpaceRow {
  id: string
  name: string
  slug: string
  status: string
}

export interface AdminData {
  stats: AdminStats
  users: AdminUserRow[]
  rooms: AdminRoomRow[]
  cardSets: AdminCardSetRow[]
  spaces: AdminSpaceRow[]
}

export const emptyAdminData: AdminData = {
  stats: { users: 0, activeRooms: 0, activePlayers: 0, activeSpaces: 0, moderationQueue: 0 },
  users: [], rooms: [], cardSets: [], spaces: [],
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value))
}

export async function fetchAdminData(): Promise<AdminData> {
  if (!supabase) return emptyAdminData

  const [profiles, rooms, members, spaces, cardSets, moderation] = await Promise.all([
    supabase.from('profiles').select('id,nickname,friend_tag,platform_role,suspended_until,deleted_at,created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(50),
    supabase.from('rooms').select('id,code,kind,status,max_players,space_id,created_at', { count: 'exact' }).in('status', ['waiting', 'playing']).order('created_at', { ascending: false }).limit(50),
    supabase.from('room_members').select('room_id,user_id', { count: 'exact' }).is('kicked_at', null),
    supabase.from('spaces').select('id,name,slug,status', { count: 'exact' }).eq('status', 'active').order('created_at', { ascending: false }).limit(50),
    supabase.from('card_sets').select('id,name,status,version,is_platform_default,spaces(name)').order('updated_at', { ascending: false }).limit(50),
    supabase.from('moderation_actions').select('id', { count: 'exact', head: true }),
  ])

  const firstError = [profiles.error, rooms.error, members.error, spaces.error, cardSets.error, moderation.error].find(Boolean)
  if (firstError) throw firstError

  const membersByRoom = new Map<string, number>()
  for (const member of members.data ?? []) membersByRoom.set(member.room_id, (membersByRoom.get(member.room_id) ?? 0) + 1)

  return {
    stats: {
      users: profiles.count ?? 0,
      activeRooms: rooms.count ?? 0,
      activePlayers: members.count ?? 0,
      activeSpaces: spaces.count ?? 0,
      moderationQueue: moderation.count ?? 0,
    },
    users: (profiles.data ?? []).map(profile => ({
      id: profile.id,
      nickname: profile.nickname,
      friendTag: profile.friend_tag,
      status: profile.deleted_at ? '탈퇴' : profile.suspended_until && new Date(profile.suspended_until) > new Date() ? '정지' : '정상',
      method: profile.platform_role === 'player' ? '플레이어' : profile.platform_role,
      joinedAt: displayDate(profile.created_at),
    })),
    rooms: (rooms.data ?? []).map(room => ({
      id: room.id,
      code: room.code ?? room.id.slice(0, 6).toUpperCase(),
      type: room.kind === 'bot' ? '봇 연습' : room.kind === 'matchmaking' ? '온라인' : '비공개',
      players: membersByRoom.get(room.id) ?? 0,
      capacity: room.max_players,
      status: room.status === 'playing' ? '게임 중' : '대기 중',
    })),
    spaces: (spaces.data ?? []).map(space => ({ id: space.id, name: space.name, slug: space.slug, status: space.status })),
    cardSets: (cardSets.data ?? []).map(cardSet => {
      const linkedSpace = Array.isArray(cardSet.spaces) ? cardSet.spaces[0] : cardSet.spaces
      return { id: cardSet.id, name: cardSet.name, scope: cardSet.is_platform_default ? '전체 공개' : linkedSpace?.name ?? '스페이스 전용', status: cardSet.status, version: cardSet.version }
    }),
  }
}

export async function executeAdminAction(action: 'suspend_user' | 'unsuspend_user' | 'deactivate_user' | 'close_room', targetId: string, reason: string) {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action, targetId, reason } })
  if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? '관리 작업을 완료하지 못했습니다.')
}
