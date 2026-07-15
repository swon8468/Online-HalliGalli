import { supabase } from './supabase'

export type SpaceRole = 'member' | 'manager' | 'owner'
export type SpaceStatus = 'draft' | 'active' | 'suspended' | 'archived'

export interface MySpace {
  id: string
  name: string
  slug: string
  status: SpaceStatus
  role: SpaceRole
  description: string | null
}

export interface SpaceMemberView {
  userId: string
  nickname: string
  friendTag: string
  email: string | null
  phone: string | null
  role: SpaceRole
  externalId: string | null
  joinedAt: string
  suspended: boolean
  deleted: boolean
}

export interface SpaceRoomView {
  id: string
  code: string
  status: string
  maxPlayers: number
  createdAt: string
}

export interface SpaceCardSetView {
  id: string
  name: string
  status: string
  version: number
  isPlatformDefault: boolean
}

export interface SpaceAdminSnapshot {
  actor: { id: string; platformRole: string; spaceRole: SpaceRole | null; canManage: boolean }
  space: { id: string; name: string; slug: string; description: string | null; status: SpaceStatus; joinCode: string; joinEnabled: boolean; allowedEmailDomain: string | null; createdAt: string }
  members: SpaceMemberView[]
  rooms: SpaceRoomView[]
  games: Array<{ id: string; roomId: string; startedAt: string; finishedAt: string | null; version: number }>
  cardSets: SpaceCardSetView[]
}

export interface SpaceAccountInput {
  email: string
  nickname: string
  password?: string
  role?: 'member' | 'manager'
  externalId?: string
}

function client() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  return supabase
}

const errors: Record<string, string> = {
  platform_admin_required: '플랫폼 관리자만 스페이스를 생성할 수 있습니다.', space_access_denied: '이 스페이스에 접근할 수 없습니다.',
  space_manager_required: '스페이스 관리자 권한이 필요합니다.', space_owner_required: '스페이스 소유자 권한이 필요합니다.',
  space_not_found: '스페이스를 찾을 수 없습니다.', space_inactive: '현재 가입할 수 없는 스페이스입니다.',
  space_join_disabled: '가입 코드 사용이 중지되어 있습니다.', invalid_space: '이름과 영문 소문자 slug를 확인해 주세요.',
  invalid_space_name: '스페이스 이름을 확인해 주세요.', invalid_space_slug: 'slug는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.',
  invalid_email_domain: '기관 이메일 도메인을 @example.org 형식으로 입력해 주세요.', manager_email_domain_mismatch: '스페이스 관리자 이메일은 지정한 기관 도메인을 사용해야 합니다.',
  invalid_manager_nickname: '스페이스 관리자 표시 이름을 2~12자로 입력해 주세요.', weak_manager_password: '스페이스 관리자 임시 비밀번호는 12자 이상이어야 합니다.',
  space_slug_exists: '이미 사용 중인 스페이스 slug입니다.', space_manager_email_exists: '이미 가입된 이메일입니다. 별도 스페이스 관리자 이메일을 입력해 주세요.',
  space_manager_creation_failed: '스페이스 관리자 계정을 만들지 못했습니다.', space_email_domain_required: '이 스페이스는 지정된 기관 이메일 계정만 가입할 수 있습니다.',
  user_not_found: '해당 이메일 계정을 찾을 수 없습니다.', cannot_modify_owner: '스페이스 소유자는 변경하거나 삭제할 수 없습니다.',
  cannot_modify_self: '자기 자신의 역할은 직접 변경할 수 없습니다.', member_not_found: '멤버를 찾을 수 없습니다.',
  invalid_bulk_size: '한 번에 1명부터 100명까지 등록할 수 있습니다.', email_required: '이메일을 입력해 주세요.',
  bulk_validation_failed: '일괄 등록 항목을 확인해 주세요. 잘못된 항목이 있어 아무 계정도 생성하지 않았습니다.',
  duplicate_bulk_email: '일괄 등록 목록에 같은 이메일이 중복되어 있습니다.',
  bulk_operation_failed: '일괄 등록을 완료하지 못해 변경 사항을 되돌렸습니다. 다시 시도해 주세요.',
}

function translate(error?: string) {
  const key = Object.keys(errors).find(item => error === item || error?.startsWith(`${item}:`))
  return key ? errors[key] : error ?? '스페이스 작업을 완료하지 못했습니다.'
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const result = await client().functions.invoke<{ ok?: boolean; error?: string; requestId?: string } & T>('space-admin', { body })
  if (result.error || !result.data?.ok) {
    const message = translate(result.data?.error ?? result.error?.message)
    throw new Error(result.data?.requestId ? `${message} (오류 번호: ${result.data.requestId})` : message)
  }
  return result.data
}

export async function fetchMySpaces(): Promise<MySpace[]> {
  const { data: { user }, error: authError } = await client().auth.getUser()
  if (authError || !user) throw authError ?? new Error('로그인이 필요합니다.')
  const { data, error } = await client().from('space_members').select('role,spaces(id,name,slug,status,description)').eq('user_id', user.id).order('joined_at', { ascending: false })
  if (error) throw error
  return (data ?? []).flatMap(member => {
    const space = Array.isArray(member.spaces) ? member.spaces[0] : member.spaces
    return space ? [{ id: space.id, name: space.name, slug: space.slug, status: space.status as SpaceStatus, role: member.role as SpaceRole, description: space.description }] : []
  })
}

export async function joinSpace(code: string): Promise<MySpace> {
  const { data, error } = await client().rpc('join_space_by_code', { p_join_code: code.trim().toUpperCase() })
  if (error) throw new Error(translate(error.message))
  return { id: data.id, name: data.name, slug: data.slug, role: data.role, status: 'active', description: null }
}

export async function createSpace(input: { name: string; slug: string; description: string; emailDomain: string; managerEmail: string; managerNickname: string; managerPassword?: string; reason: string }) {
  return invoke<{ space: { id: string; slug: string }; manager: { userId: string; email: string; nickname: string; role: 'manager'; password: string; created: true } }>({ action: 'create_space', ...input })
}

export async function loadSpaceAdmin(slug: string): Promise<SpaceAdminSnapshot> {
  const lookup = await client().from('spaces').select('id').eq('slug', slug).maybeSingle()
  if (lookup.error) throw lookup.error
  if (!lookup.data) throw new Error('스페이스를 찾을 수 없습니다.')
  const result = await invoke<{
    actor: SpaceAdminSnapshot['actor']
    data: {
      space: { id: string; name: string; slug: string; description: string | null; status: SpaceStatus; join_code: string; join_enabled: boolean; allowed_email_domain: string | null; created_at: string }
      members: Array<{ user_id: string; role: SpaceRole; student_or_employee_id: string | null; joined_at: string; email: string | null; phone: string | null; profiles: { nickname: string; friend_tag: string; deleted_at: string | null; suspended_until: string | null } | Array<{ nickname: string; friend_tag: string; deleted_at: string | null; suspended_until: string | null }> | null }>
      rooms: Array<{ id: string; code: string; status: string; max_players: number; created_at: string }>
      games: Array<{ id: string; room_id: string; started_at: string; finished_at: string | null; version: number }>
      cardSets: Array<{ id: string; name: string; status: string; version: number; is_platform_default: boolean }>
    }
  }>({ action: 'snapshot', spaceId: lookup.data.id })
  const value = result.data
  return {
    actor: result.actor,
    space: { id: value.space.id, name: value.space.name, slug: value.space.slug, description: value.space.description, status: value.space.status, joinCode: value.space.join_code, joinEnabled: value.space.join_enabled, allowedEmailDomain: value.space.allowed_email_domain, createdAt: value.space.created_at },
    members: value.members.map(member => {
      const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles
      return { userId: member.user_id, nickname: profile?.nickname ?? '알 수 없음', friendTag: profile?.friend_tag ?? '-', email: member.email, phone: member.phone, role: member.role, externalId: member.student_or_employee_id, joinedAt: member.joined_at, suspended: Boolean(profile?.suspended_until && new Date(profile.suspended_until) > new Date()), deleted: Boolean(profile?.deleted_at) }
    }),
    rooms: value.rooms.map(room => ({ id: room.id, code: room.code, status: room.status, maxPlayers: room.max_players, createdAt: room.created_at })),
    games: value.games.map(game => ({ id: game.id, roomId: game.room_id, startedAt: game.started_at, finishedAt: game.finished_at, version: game.version })),
    cardSets: value.cardSets.map(set => ({ id: set.id, name: set.name, status: set.status, version: set.version, isPlatformDefault: set.is_platform_default })),
  }
}

export function updateSpace(spaceId: string, input: { name?: string; slug?: string; description?: string; status?: SpaceStatus; joinEnabled?: boolean; reason: string }) { return invoke({ action: 'update_space', spaceId, ...input }) }
export function rotateSpaceCode(spaceId: string, reason: string) { return invoke<{ joinCode: string }>({ action: 'rotate_join_code', spaceId, reason }) }
export function addExistingSpaceMember(spaceId: string, input: SpaceAccountInput, reason: string) { return invoke({ action: 'add_existing', spaceId, ...input, reason }) }
export function createSpaceAccount(spaceId: string, input: SpaceAccountInput, reason: string) { return invoke<{ account: { userId: string; email: string; nickname: string; role: SpaceRole; password: string | null; created: boolean } }>({ action: 'create_account', spaceId, ...input, reason }) }
export function bulkCreateSpaceAccounts(spaceId: string, accounts: SpaceAccountInput[], reason: string) { return invoke<{ accounts: Array<{ email: string; nickname: string; role: SpaceRole; password: string | null; created: boolean }>; failures: Array<{ email: string; error: string }> }>({ action: 'bulk_create_accounts', spaceId, accounts, reason }) }
export function updateSpaceMember(spaceId: string, targetUserId: string, role: 'member' | 'manager', reason: string) { return invoke({ action: 'update_member', spaceId, targetUserId, role, reason }) }
export function removeSpaceMember(spaceId: string, targetUserId: string, reason: string) { return invoke({ action: 'remove_member', spaceId, targetUserId, reason }) }
