import { createUuid } from './id'
import { supabase } from './supabase'

export type SpaceRole = 'member' | 'manager' | 'owner'
export type SpaceStatus = 'draft' | 'active' | 'suspended' | 'archived'
export type JoinPolicy = 'code' | 'invite_only' | 'closed'
export type AccountKind = 'managed' | 'existing'
export type AccountStatus = 'active' | 'suspended' | 'deactivated'

export interface MySpace {
  id: string
  name: string
  slug: string
  status: SpaceStatus
  role: SpaceRole
  description: string | null
}

export interface SpaceActor {
  id: string
  platformRole: string
  spaceRole: SpaceRole | null
  canView: boolean
  canManage: boolean
  canOwn: boolean
  piiMasked: boolean
}

export interface SpaceOverview {
  actor: SpaceActor
  space: {
    id: string
    name: string
    slug: string
    description: string | null
    status: SpaceStatus
    joinCode: string
    joinEnabled: boolean
    joinPolicy: JoinPolicy
    joinCodeExpiresAt: string | null
    emailDomains: string[]
    createdAt: string
  }
  metrics: { members: number; rooms: number; activeRooms: number; games: number; finishedGames: number; cardSets: number; audit: number }
}

export interface SpaceMemberView {
  userId: string
  nickname: string
  friendTag: string
  email: string | null
  phone: string | null
  lastSignInAt: string | null
  role: SpaceRole
  externalId: string | null
  joinedAt: string
  suspended: boolean
  deleted: boolean
  accountKind: AccountKind
  accountStatus: AccountStatus
  mustChangePassword: boolean
  managedAt: string
  lastManagedAt: string | null
}

export interface SpaceRoomView {
  id: string
  code: string
  kind: string
  status: string
  host_id: string
  host_nickname: string
  max_players: number
  participant_count: number
  card_set_id: string | null
  created_at: string
  updated_at: string
  latest_game: { id: string; room_id: string; started_at: string; finished_at: string | null; version: number } | null
}

export interface SpaceGameView {
  id: string
  room_id: string
  started_at: string
  finished_at: string | null
  version: number
  state: Record<string, unknown>
  rooms: { space_id: string; code: string; status: string } | Array<{ space_id: string; code: string; status: string }>
}

export interface SpaceCardSetView {
  id: string
  name: string
  status: string
  version: number
  is_platform_default: boolean
  space_id: string | null
  updated_at: string
}

export interface SpaceAuditView {
  id: string
  actor_id: string
  action: string
  reason: string
  metadata: Record<string, unknown>
  created_at: string
  profiles: { nickname: string } | Array<{ nickname: string }> | null
}

export interface PageResult<T> { items: T[]; page: number; pageSize: number; total: number }
export interface PageOptions {
  page?: number
  pageSize?: number
  search?: string
  roleFilter?: SpaceRole | 'all'
  statusFilter?: string
  kindFilter?: AccountKind | 'all'
  sort?: string
}

export interface SpaceAccountInput {
  email: string
  nickname: string
  password?: string
  role?: 'member' | 'manager'
  externalId?: string
}

export interface CreatedCredential {
  userId?: string
  email: string
  nickname?: string
  role?: SpaceRole
  password: string | null
  created?: boolean
}

function client() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  return supabase
}

const errors: Record<string, string> = {
  unauthorized: '로그인이 필요합니다.', forbidden: '현재 계정으로 이 작업을 할 수 없습니다.',
  platform_admin_required: '플랫폼 관리자만 스페이스를 생성할 수 있습니다.', space_access_denied: '이 스페이스에 접근할 수 없습니다.',
  space_manager_required: '스페이스 관리자 권한이 필요합니다.', space_owner_required: '스페이스 소유자 권한이 필요합니다.',
  space_not_found: '스페이스를 찾을 수 없습니다.', space_inactive: '현재 가입할 수 없는 스페이스입니다.', space_archived: '보관된 스페이스에서는 이 작업을 할 수 없습니다.',
  space_join_disabled: '현재 가입 코드로 참여할 수 없습니다.', space_join_code_expired: '가입 코드가 만료되었습니다.',
  invalid_space: '이름과 영문 소문자 slug를 확인해 주세요.', invalid_space_name: '스페이스 이름을 확인해 주세요.',
  invalid_space_slug: 'slug는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.', invalid_manager_mode: '관리자 계정 방식을 확인해 주세요.',
  invalid_email_domain: '기관 이메일 도메인을 @example.org 형식으로 입력해 주세요.', manager_email_domain_mismatch: '관리자 이메일이 허용 도메인과 일치하지 않습니다.',
  invalid_manager_nickname: '관리자 표시 이름을 2~12자로 입력해 주세요.', weak_manager_password: '관리자 임시 비밀번호는 12자 이상이어야 합니다.',
  space_slug_exists: '이미 사용 중이거나 이전 주소로 예약된 slug입니다.', space_manager_email_exists: '이미 가입된 이메일입니다. 기존 계정 연결을 선택해 주세요.',
  space_manager_creation_failed: '스페이스 관리자 계정을 만들지 못했습니다.', space_email_domain_required: '허용된 기관 이메일 도메인의 계정만 사용할 수 있습니다.',
  user_not_found: '해당 이메일 계정을 찾을 수 없습니다.', cannot_modify_owner: '스페이스 소유자는 이 작업의 대상이 될 수 없습니다.',
  cannot_modify_self: '자기 계정에는 이 작업을 수행할 수 없습니다.', member_not_found: '멤버를 찾을 수 없습니다.', target_required: '작업 대상을 선택해 주세요.',
  invalid_bulk_size: '한 번에 1명부터 100명까지 처리할 수 있습니다.', email_required: '이메일을 입력해 주세요.', invalid_account: '이메일과 2~12자 표시 이름을 확인해 주세요.',
  bulk_validation_failed: '일괄 등록 항목을 확인해 주세요. 오류가 있어 아무 계정도 생성하지 않았습니다.', duplicate_bulk_email: '목록에 같은 이메일이 중복되어 있습니다.',
  bulk_operation_failed: '일괄 등록을 완료하지 못해 생성된 계정을 되돌렸습니다.', account_already_exists: '이미 존재하는 계정입니다. 기존 계정 연결을 이용해 주세요.',
  weak_password: '임시 비밀번호는 12자 이상이어야 합니다.', existing_account_protected: '기존 개인 계정은 스페이스에서 비밀번호·정지·삭제를 관리할 수 없습니다.',
  member_active_game: '진행 중인 게임에 참여한 멤버는 제외할 수 없습니다.', member_active_session: '대기 중인 방에 참여 중입니다. 방에서 내보낸 뒤 다시 시도하거나 강제 제외를 선택하세요.',
  managed_account_active_session: '활성 방 세션이 있는 계정은 삭제할 수 없습니다.', managed_account_has_other_spaces: '다른 스페이스에도 가입된 계정은 삭제할 수 없습니다.',
  managed_account_has_platform_relationships: '친구·초대 관계가 있는 계정은 안전을 위해 삭제할 수 없습니다.',
  action_id_required: '안전한 재시도를 위한 요청 식별자가 없습니다.', action_in_progress: '같은 작업이 이미 처리 중입니다.', action_already_processed: '같은 작업 요청이 이미 처리되었습니다.',
  space_action_rate_limited: '작업 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', room_not_found: '방을 찾을 수 없습니다.', room_not_active: '이미 종료된 방입니다.',
  ownership_transfer_failed: '소유권을 이전하지 못했습니다.', cannot_transfer_to_self: '자기 자신에게 소유권을 이전할 수 없습니다.',
}

export function translateSpaceError(error?: string) {
  const key = Object.keys(errors).find(item => error === item || error?.startsWith(`${item}:`))
  return key ? errors[key] : error ?? '스페이스 작업을 완료하지 못했습니다.'
}

const sensitiveActions = new Set([
  'create_space', 'update_space', 'rotate_join_code', 'add_existing', 'update_member', 'remove_member', 'transfer_owner',
  'create_account', 'bulk_create_accounts', 'update_account', 'reset_password', 'suspend_account', 'reactivate_account',
  'delete_account', 'bulk_update_members', 'close_room',
])

async function invoke<T>(body: Record<string, unknown>, requestId?: string): Promise<T> {
  const action = String(body.action ?? '')
  const payload = sensitiveActions.has(action) ? { ...body, requestId: requestId ?? createUuid() } : body
  const result = await client().functions.invoke<{ ok?: boolean; error?: string; requestId?: string; failures?: Array<{ row: number; error: string }> } & T>('space-admin', { body: payload })
  let responseData = result.data
  if (result.error && 'context' in result.error && result.error.context instanceof Response) responseData = await result.error.context.json().catch(() => result.data)
  if (result.error || !responseData?.ok) {
    const base = translateSpaceError(responseData?.error ?? result.error?.message)
    const rowText = responseData?.failures?.length ? ` (${responseData.failures.map(item => `${item.row}행: ${translateSpaceError(item.error)}`).join(', ')})` : ''
    const message = `${base}${rowText}`
    throw new Error(responseData?.requestId ? `${message} (오류 번호: ${responseData.requestId})` : message)
  }
  return responseData
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
  if (error) throw new Error(translateSpaceError(error.message))
  return { id: data.id, name: data.name, slug: data.slug, role: data.role, status: 'active', description: null }
}

function mapOverview(result: { actor: SpaceActor; data: { space: Record<string, unknown>; metrics: SpaceOverview['metrics'] } }): SpaceOverview {
  const space = result.data.space
  return {
    actor: result.actor,
    space: {
      id: String(space.id), name: String(space.name), slug: String(space.slug), description: space.description ? String(space.description) : null,
      status: space.status as SpaceStatus, joinCode: space.join_code ? String(space.join_code) : '', joinEnabled: Boolean(space.join_enabled), joinPolicy: space.join_policy as JoinPolicy,
      joinCodeExpiresAt: space.join_code_expires_at ? String(space.join_code_expires_at) : null,
      emailDomains: Array.isArray(space.allowed_email_domains) ? space.allowed_email_domains.map(String) : [], createdAt: String(space.created_at),
    },
    metrics: result.data.metrics,
  }
}

export async function checkSpaceSlug(slug: string) { return invoke<{ available: boolean }>({ action: 'check_slug', slug }) }

export async function createSpace(input: {
  name: string; slug: string; description: string; emailDomains: string[]; managerMode: 'none' | 'create' | 'existing';
  managerEmail?: string; managerNickname?: string; managerPassword?: string; joinPolicy?: JoinPolicy; joinEnabled?: boolean; joinCodeExpiresAt?: string | null
}, requestId?: string) {
  return invoke<{ space: { id: string; slug: string; join_code: string }; manager: CreatedCredential | null }>({ action: 'create_space', ...input }, requestId)
}

export async function loadSpaceOverview(slug: string): Promise<SpaceOverview> {
  const result = await invoke<{ actor: SpaceActor; data: { space: Record<string, unknown>; metrics: SpaceOverview['metrics'] } }>({ action: 'snapshot', slug })
  return mapOverview(result)
}

function page<T>(action: string, spaceId: string, options: PageOptions = {}) {
  return invoke<{ actor: SpaceActor; data: PageResult<T> }>({ action, spaceId, ...options })
}

export const loadSpaceMembers = (spaceId: string, options?: PageOptions) => page<SpaceMemberView>('members_page', spaceId, options)
export const loadSpaceRooms = (spaceId: string, options?: PageOptions) => page<SpaceRoomView>('rooms_page', spaceId, options)
export const loadSpaceGames = (spaceId: string, options?: PageOptions) => page<SpaceGameView>('games_page', spaceId, options)
export const loadSpaceCards = (spaceId: string, options?: PageOptions) => page<SpaceCardSetView>('cards_page', spaceId, options)
export const loadSpaceAudit = (spaceId: string, options?: PageOptions) => page<SpaceAuditView>('audit_page', spaceId, options)

export function updateSpace(spaceId: string, input: { name?: string; slug?: string; description?: string; status?: SpaceStatus; joinEnabled?: boolean; joinPolicy?: JoinPolicy; joinCodeExpiresAt?: string | null; emailDomains?: string[] }, requestId?: string) { return invoke({ action: 'update_space', spaceId, ...input }, requestId) }
export function rotateSpaceCode(spaceId: string, joinCodeExpiresAt?: string | null, requestId?: string) { return invoke<{ joinCode: string }>({ action: 'rotate_join_code', spaceId, joinCodeExpiresAt }, requestId) }
export function addExistingSpaceMember(spaceId: string, input: SpaceAccountInput, requestId?: string) { return invoke<{ userId: string }>({ action: 'add_existing', spaceId, ...input }, requestId) }
export function createSpaceAccount(spaceId: string, input: SpaceAccountInput, requestId?: string) { return invoke<{ account: CreatedCredential }>({ action: 'create_account', spaceId, ...input }, requestId) }
export function bulkCreateSpaceAccounts(spaceId: string, accounts: SpaceAccountInput[], requestId?: string) { return invoke<{ accounts: CreatedCredential[]; failures: Array<{ row: number; error: string }>; policy: 'atomic' }>({ action: 'bulk_create_accounts', spaceId, accounts }, requestId) }
export function updateSpaceMember(spaceId: string, targetUserId: string, role: 'member' | 'manager', requestId?: string) { return invoke({ action: 'update_member', spaceId, targetUserId, role }, requestId) }
export function removeSpaceMember(spaceId: string, targetUserId: string, force = false, requestId?: string) { return invoke({ action: 'remove_member', spaceId, targetUserId, force }, requestId) }
export function transferSpaceOwner(spaceId: string, targetUserId: string, requestId?: string) { return invoke({ action: 'transfer_owner', spaceId, targetUserId }, requestId) }
export function updateManagedSpaceAccount(spaceId: string, targetUserId: string, input: { nickname?: string; externalId?: string }, requestId?: string) { return invoke({ action: 'update_account', spaceId, targetUserId, ...input }, requestId) }
export function resetManagedSpacePassword(spaceId: string, targetUserId: string, requestId?: string) { return invoke<{ credential: { password: string } }>({ action: 'reset_password', spaceId, targetUserId }, requestId) }
export function suspendManagedSpaceAccount(spaceId: string, targetUserId: string, requestId?: string) { return invoke({ action: 'suspend_account', spaceId, targetUserId }, requestId) }
export function reactivateManagedSpaceAccount(spaceId: string, targetUserId: string, requestId?: string) { return invoke({ action: 'reactivate_account', spaceId, targetUserId }, requestId) }
export function deleteManagedSpaceAccount(spaceId: string, targetUserId: string, requestId?: string) { return invoke({ action: 'delete_account', spaceId, targetUserId }, requestId) }
export function bulkUpdateSpaceMembers(spaceId: string, items: Array<{ userId: string; operation: 'role' | 'remove' | 'suspend'; role?: 'member' | 'manager' }>, requestId?: string) { return invoke<{ results: Array<{ userId: string; ok: boolean; error?: string }>; policy: 'partial' }>({ action: 'bulk_update_members', spaceId, items }, requestId) }
export function closeSpaceRoom(spaceId: string, targetRoomId: string, requestId?: string) { return invoke({ action: 'close_room', spaceId, targetRoomId }, requestId) }
