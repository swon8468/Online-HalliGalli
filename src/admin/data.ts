import { supabase } from '../lib/supabase'

export type PlatformRole = 'player' | 'support' | 'admin' | 'super_admin'
export type AdminAction = 'suspend_user' | 'unsuspend_user' | 'deactivate_user' | 'close_room' | 'change_role' | 'create_admin'

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
  email: string | null
  phone: string | null
  status: '정상' | '정지' | '탈퇴'
  role: PlatformRole
  roleLabel: string
  joinedAt: string
  lastSignInAt: string | null
  suspendedUntil: string | null
  suspensionReason: string | null
}

export interface AdminRoomMember {
  userId: string
  nickname: string
  role: string
  joinedAt: string
  leftAt: string | null
  kickedAt: string | null
  kickReason: string | null
}

export interface AdminRoomRow {
  id: string
  code: string
  type: string
  players: number
  capacity: number
  status: string
  statusKey: string
  hostNickname: string
  createdAt: string
  gameId: string | null
  gameVersion: number | null
  gameStartedAt: string | null
  gameFinishedAt: string | null
  members: AdminRoomMember[]
}

export interface AdminAuditRow {
  id: number
  actorNickname: string
  target: string
  action: string
  actionLabel: string
  reason: string
  metadata: Record<string, unknown>
  createdAt: string
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

export interface AdminActor {
  id: string
  nickname: string
  role: PlatformRole
}

export interface AdminData {
  actor: AdminActor | null
  stats: AdminStats
  users: AdminUserRow[]
  rooms: AdminRoomRow[]
  audit: AdminAuditRow[]
  cardSets: AdminCardSetRow[]
  spaces: AdminSpaceRow[]
}

export const emptyAdminData: AdminData = {
  actor: null,
  stats: { users: 0, activeRooms: 0, activePlayers: 0, activeSpaces: 0, moderationQueue: 0 },
  users: [], rooms: [], audit: [], cardSets: [], spaces: [],
}

type SnapshotProfile = {
  id: string
  nickname: string
  friend_tag: string
  platform_role: PlatformRole
  suspended_until: string | null
  suspension_reason: string | null
  deleted_at: string | null
  created_at: string
  email?: string | null
  phone?: string | null
  lastSignInAt?: string | null
}

type SnapshotRoom = {
  id: string
  code: string | null
  kind: string
  status: string
  max_players: number
  hostNickname: string
  created_at: string
  game: { id: string; version: number; started_at: string; finished_at: string | null } | null
  members: Array<{ user_id: string; nickname: string; role: string; joined_at: string; left_at: string | null; kicked_at: string | null; kick_reason: string | null }>
}

type SnapshotAudit = {
  id: number
  actorNickname: string
  targetNickname: string | null
  target_room_id: string | null
  target_space_id: string | null
  action: string
  reason: string
  metadata: Record<string, unknown>
  created_at: string
}

type SnapshotResponse = {
  ok?: boolean
  error?: string
  actor?: AdminActor
  data?: {
    profiles: SnapshotProfile[]
    rooms: SnapshotRoom[]
    spaces: Array<{ id: string; name: string; slug: string; status: string }>
    cardSets: Array<{ id: string; name: string; status: string; version: number; is_platform_default: boolean; space_id: string | null }>
    audit: SnapshotAudit[]
  }
}

const roleLabels: Record<PlatformRole, string> = {
  player: '플레이어', support: '지원 담당자', admin: '플랫폼 관리자', super_admin: '슈퍼 관리자',
}

const actionLabels: Record<string, string> = {
  bootstrap_super_admin: '최초 슈퍼 관리자 생성', warn: '경고', suspend: '계정 정지', unsuspend: '정지 해제',
  soft_delete: '계정 비활성화', close_room: '방 강제 종료', suspend_space: '스페이스 정지',
  restore_space: '스페이스 복구', role_change: '권한 변경', create_admin: '관리자 계정 생성',
}

function displayDate(value: string | null, withTime = false) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value))
}

function translateAdminError(error?: string) {
  const known: Record<string, string> = {
    forbidden: '관리자 콘솔에 접근할 권한이 없습니다.', read_only_role: '지원 담당자는 조회만 할 수 있습니다.',
    super_admin_required: '슈퍼 관리자만 수행할 수 있습니다.', cannot_manage_super_admin: '슈퍼 관리자 계정은 변경할 수 없습니다.',
    cannot_restrict_self: '자기 계정은 직접 제한할 수 없습니다.', user_not_found: '사용자를 찾을 수 없습니다.',
    room_not_found: '방을 찾을 수 없습니다.', invalid_reason: '사유를 2자 이상 입력해 주세요.',
    weak_password: '관리자 비밀번호는 12자 이상이어야 합니다.', invalid_admin_account: '관리자 계정 정보를 확인해 주세요.',
    invalid_role: '변경할 수 없는 권한입니다.',
  }
  return known[error ?? ''] ?? error ?? '관리 작업을 완료하지 못했습니다.'
}

async function invokeAdmin<T extends { ok?: boolean; error?: string; requestId?: string }>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  const { data, error } = await supabase.functions.invoke<T>('admin-actions', { body })
  if (error || !data?.ok) {
    const message = translateAdminError(data?.error ?? error?.message)
    throw new Error(data?.requestId ? `${message} (오류 번호: ${data.requestId})` : message)
  }
  return data
}

export async function fetchAdminData(): Promise<AdminData> {
  const snapshot = await invokeAdmin<SnapshotResponse>({ action: 'snapshot' })
  if (!snapshot.data) throw new Error('관리자 데이터를 불러오지 못했습니다.')
  const profiles = snapshot.data.profiles ?? []
  const rooms = snapshot.data.rooms ?? []
  const spaces = snapshot.data.spaces ?? []
  const cardSets = snapshot.data.cardSets ?? []
  const audit = snapshot.data.audit ?? []
  const spaceById = new Map(spaces.map(space => [space.id, space.name]))
  const now = Date.now()

  return {
    actor: snapshot.actor ?? null,
    stats: {
      users: profiles.length,
      activeRooms: rooms.filter(room => ['waiting', 'playing'].includes(room.status)).length,
      activePlayers: rooms.filter(room => ['waiting', 'playing'].includes(room.status)).reduce((sum, room) => sum + room.members.filter(member => !member.left_at && !member.kicked_at).length, 0),
      activeSpaces: spaces.filter(space => space.status === 'active').length,
      moderationQueue: audit.length,
    },
    users: profiles.map(profile => ({
      id: profile.id,
      nickname: profile.nickname,
      friendTag: profile.friend_tag,
      email: profile.email ?? null,
      phone: profile.phone ?? null,
      status: profile.deleted_at ? '탈퇴' : profile.suspended_until && new Date(profile.suspended_until).getTime() > now ? '정지' : '정상',
      role: profile.platform_role,
      roleLabel: roleLabels[profile.platform_role],
      joinedAt: displayDate(profile.created_at),
      lastSignInAt: profile.lastSignInAt ?? null,
      suspendedUntil: profile.suspended_until,
      suspensionReason: profile.suspension_reason,
    })),
    rooms: rooms.map(room => ({
      id: room.id,
      code: room.code ?? room.id.slice(0, 6).toUpperCase(),
      type: room.kind === 'bot' ? '봇 연습' : room.kind === 'matchmaking' ? '온라인' : '비공개',
      players: room.members.filter(member => !member.left_at && !member.kicked_at).length,
      capacity: room.max_players,
      status: room.status === 'playing' ? '게임 중' : room.status === 'waiting' ? '대기 중' : room.status === 'finished' ? '종료됨' : '닫힘',
      statusKey: room.status,
      hostNickname: room.hostNickname,
      createdAt: displayDate(room.created_at, true),
      gameId: room.game?.id ?? null,
      gameVersion: room.game?.version ?? null,
      gameStartedAt: room.game?.started_at ?? null,
      gameFinishedAt: room.game?.finished_at ?? null,
      members: room.members.map(member => ({
        userId: member.user_id, nickname: member.nickname, role: member.role, joinedAt: member.joined_at,
        leftAt: member.left_at, kickedAt: member.kicked_at, kickReason: member.kick_reason,
      })),
    })),
    audit: audit.map(entry => ({
      id: entry.id,
      actorNickname: entry.actorNickname,
      target: entry.targetNickname ?? entry.target_room_id?.slice(0, 8).toUpperCase() ?? entry.target_space_id?.slice(0, 8).toUpperCase() ?? '-',
      action: entry.action,
      actionLabel: actionLabels[entry.action] ?? entry.action,
      reason: entry.reason,
      metadata: entry.metadata ?? {},
      createdAt: displayDate(entry.created_at, true),
    })),
    spaces: spaces.map(space => ({ id: space.id, name: space.name, slug: space.slug, status: space.status })),
    cardSets: cardSets.map(cardSet => ({
      id: cardSet.id, name: cardSet.name,
      scope: cardSet.is_platform_default ? '전체 공개' : cardSet.space_id ? spaceById.get(cardSet.space_id) ?? '스페이스 전용' : '플랫폼',
      status: cardSet.status, version: cardSet.version,
    })),
  }
}

export interface AdminActionPayload {
  action: AdminAction
  targetId?: string
  reason: string
  durationDays?: number | null
  role?: PlatformRole
  email?: string
  password?: string
  nickname?: string
}

export async function executeAdminAction(payload: AdminActionPayload) {
  await invokeAdmin({ ...payload })
}
