import { supabase } from './supabase'
import { createUuid } from './id'

export type CardFruit = 'strawberry' | 'banana' | 'lime' | 'plum'
export type CardSetStatus = 'draft' | 'published' | 'archived'

export interface CardSetSummary {
  id: string
  name: string
  description: string | null
  status: CardSetStatus
  version: number
  isPlatformDefault: boolean
  spaceId: string | null
  spaceName: string | null
  backAssetPath: string | null
  backDesign: Record<string, string>
  updatedAt: string
}

export interface CardDesignRecord {
  id: string
  cardSetId: string
  fruit: CardFruit
  count: number
  quantity: number
  label: string
  frontAssetPath: string | null
  design: Record<string, string>
  sortOrder: number
}

export interface CardSetDetail extends CardSetSummary {
  designs: CardDesignRecord[]
  versions: Array<{ id: string; version: number; publishedAt: string; snapshot: Record<string, unknown> }>
  canManage: boolean
}

function client() { if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.'); return supabase }
const messages: Record<string, string> = {
  invalid_card_set: '카드 세트 이름을 확인해 주세요.', platform_admin_required: '플랫폼 관리자 권한이 필요합니다.',
  space_manager_required: '스페이스 관리자 권한이 필요합니다.', card_set_not_found: '카드 세트를 찾을 수 없습니다.',
  card_set_access_denied: '카드 세트를 변경할 권한이 없습니다.', incomplete_card_set: '네 가지 과일의 1~5개 디자인이 모두 필요합니다.',
  cannot_unpublish_default: '기본 카드 세트는 게시 취소할 수 없습니다.', cannot_delete_default: '기본 카드 세트는 삭제할 수 없습니다.',
  card_set_in_use: '방이나 과거 게임에서 사용 중인 카드 세트는 삭제할 수 없습니다.', unpublish_before_edit: '게시를 취소한 뒤 디자인을 수정해 주세요.',
}
function translate(error: { message?: string } | string) { const value = typeof error === 'string' ? error : error.message ?? ''; const key = Object.keys(messages).find(item => value.includes(item)); return key ? messages[key] : value || '카드 작업을 완료하지 못했습니다.' }

function mapSummary(row: {
  id: string; name: string; description: string | null; status: CardSetStatus; version: number; is_platform_default: boolean;
  space_id: string | null; back_asset_path: string | null; back_design: Record<string, string>; updated_at: string;
  spaces?: { name: string } | Array<{ name: string }> | null;
}): CardSetSummary {
  const space = Array.isArray(row.spaces) ? row.spaces[0] : row.spaces
  return { id: row.id, name: row.name, description: row.description, status: row.status, version: row.version, isPlatformDefault: row.is_platform_default, spaceId: row.space_id, spaceName: space?.name ?? null, backAssetPath: row.back_asset_path, backDesign: row.back_design ?? {}, updatedAt: row.updated_at }
}

export async function listCardSets(spaceId?: string | null): Promise<CardSetSummary[]> {
  let query = client().from('card_sets').select('id,name,description,status,version,is_platform_default,space_id,back_asset_path,back_design,updated_at,spaces(name)').order('is_platform_default', { ascending: false }).order('updated_at', { ascending: false })
  if (spaceId) query = query.or(`space_id.eq.${spaceId},is_platform_default.eq.true`)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(row => mapSummary(row as Parameters<typeof mapSummary>[0]))
}

export async function loadCardSet(cardSetId: string): Promise<CardSetDetail> {
  const [setResult, designsResult, versionsResult, manageResult] = await Promise.all([
    client().from('card_sets').select('id,name,description,status,version,is_platform_default,space_id,back_asset_path,back_design,updated_at,spaces(name)').eq('id', cardSetId).single(),
    client().from('card_designs').select('id,card_set_id,fruit_type,fruit_count,quantity,label,front_asset_path,design,sort_order').eq('card_set_id', cardSetId).order('fruit_type').order('fruit_count'),
    client().from('card_set_versions').select('id,version,published_at,snapshot').eq('card_set_id', cardSetId).order('version', { ascending: false }),
    client().rpc('can_manage_card_set', { p_card_set_id: cardSetId }),
  ])
  const error = setResult.error ?? designsResult.error ?? versionsResult.error ?? manageResult.error
  if (error) throw new Error(translate(error))
  return {
    ...mapSummary(setResult.data as Parameters<typeof mapSummary>[0]),
    designs: (designsResult.data ?? []).map(row => ({ id: row.id, cardSetId: row.card_set_id, fruit: row.fruit_type as CardFruit, count: row.fruit_count, quantity: row.quantity, label: row.label ?? '', frontAssetPath: row.front_asset_path, design: row.design ?? {}, sortOrder: row.sort_order })),
    versions: (versionsResult.data ?? []).map(row => ({ id: row.id, version: row.version, publishedAt: row.published_at, snapshot: row.snapshot as Record<string, unknown> })),
    canManage: Boolean(manageResult.data),
  }
}

export async function createCardSet(name: string, description: string, spaceId: string | null) {
  const { data, error } = await client().rpc('create_card_set', { p_name: name, p_description: description, p_space_id: spaceId })
  if (error) throw new Error(translate(error))
  return (Array.isArray(data) ? data[0] : data) as { id: string }
}
export async function cloneCardSet(sourceId: string, name: string, destinationSpaceId: string | null) { const { data, error } = await client().rpc('clone_card_set', { p_source_id: sourceId, p_name: name, p_space_id: destinationSpaceId }); if (error) throw new Error(translate(error)); return (Array.isArray(data) ? data[0] : data) as { id: string } }
export async function publishCardSet(cardSetId: string) { const { error } = await client().rpc('publish_card_set', { p_card_set_id: cardSetId }); if (error) throw new Error(translate(error)) }
export async function unpublishCardSet(cardSetId: string) { const { error } = await client().rpc('unpublish_card_set', { p_card_set_id: cardSetId }); if (error) throw new Error(translate(error)) }
export async function deleteCardSet(cardSetId: string) {
  const result = await client().functions.invoke<{ ok?: boolean; error?: string; requestId?: string; storageCleanupPending?: boolean }>('delete-card-set', { body: { cardSetId } })
  if (result.error || !result.data?.ok) {
    const message = translate(result.data?.error ?? result.error?.message)
    throw new Error(result.data?.requestId ? `${message} (오류 번호: ${result.data.requestId})` : message)
  }
  return { storageCleanupPending: Boolean(result.data.storageCleanupPending) }
}

export async function saveCardSetMeta(cardSetId: string, values: { name: string; description: string; backAssetPath: string | null; backDesign: Record<string, string> }) {
  const { error } = await client().from('card_sets').update({ name: values.name.trim(), description: values.description.trim() || null, back_asset_path: values.backAssetPath, back_design: values.backDesign, updated_at: new Date().toISOString() }).eq('id', cardSetId)
  if (error) throw new Error(translate(error))
}

export async function saveCardDesign(design: CardDesignRecord) {
  const { error } = await client().from('card_designs').update({ quantity: design.quantity, label: design.label.trim(), front_asset_path: design.frontAssetPath, design: design.design, sort_order: design.sortOrder }).eq('id', design.id)
  if (error) throw new Error(translate(error))
}

const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
export async function uploadCardAsset(cardSetId: string, file: File, kind: string) {
  if (!allowedTypes.has(file.type)) throw new Error('PNG, JPEG, WebP, SVG 이미지만 업로드할 수 있습니다.')
  if (file.size > 2 * 1024 * 1024) throw new Error('이미지는 2MB 이하여야 합니다.')
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${cardSetId}/${kind}-${createUuid()}.${extension}`
  const { error } = await client().storage.from('card-assets').upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type })
  if (error) throw error
  return path
}

export function cardAssetUrl(path: string | null) { return path ? client().storage.from('card-assets').getPublicUrl(path).data.publicUrl : null }
export async function setRoomCardSet(roomId: string, cardSetId: string | null) { const { error } = await client().rpc('set_room_card_set', { p_room_id: roomId, p_card_set_id: cardSetId }); if (error) throw new Error(translate(error)) }
