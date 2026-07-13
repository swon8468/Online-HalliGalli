import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { accounts, connectedEnvironment } from './fixture'

test.afterEach(async () => {
  const { admin } = await connectedEnvironment()
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 100 })
  if (listed.error) throw listed.error
  const ids = listed.data.users.filter(user => accounts.some(account => account.email === user.email)).map(user => user.id)
  if (!ids.length) return
  const rooms = await admin.from('rooms').select('id').in('host_id', ids)
  if (rooms.error) throw rooms.error
  if (rooms.data.length) {
    const removedRooms = await admin.from('rooms').delete().in('id', rooms.data.map(room => room.id))
    if (removedRooms.error) throw removedRooms.error
  }
  const removedFriendships = await admin.from('friendships').delete().in('user_low', ids).in('user_high', ids)
  if (removedFriendships.error) throw removedFriendships.error
})

async function login(page: Page, email: string, password: string) {
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
}

test('만료된 초대 수락 오류는 목록 새로고침 뒤에도 사용자에게 남는다', async ({ page }) => {
  const { admin, url, anon, password } = await connectedEnvironment()
  const host = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const hostAuth = await host.auth.signInWithPassword({ email: accounts[0].email, password })
  if (hostAuth.error || !hostAuth.data.user) throw hostAuth.error ?? new Error('초대 발신 계정 로그인 실패')
  const receiver = (await admin.auth.admin.listUsers({ page: 1, perPage: 100 })).data.users.find(user => user.email === accounts[1].email)
  if (!receiver) throw new Error('초대 수신 계정을 찾지 못했습니다.')
  const pair = [hostAuth.data.user.id, receiver.id].sort()
  const friendship = await admin.from('friendships').upsert({ user_low: pair[0], user_high: pair[1] }, { onConflict: 'user_low,user_high' })
  if (friendship.error) throw friendship.error
  const room = await host.rpc('create_private_room', { p_max_players: 2 })
  if (room.error) throw room.error
  const createdRoom = Array.isArray(room.data) ? room.data[0] : room.data
  const sent = await host.rpc('send_game_invite', { p_receiver_id: receiver.id, p_room_id: createdRoom.id })
  if (sent.error) throw sent.error
  const invite = sent.data as { id: string }

  await login(page, accounts[1].email, password)
  await page.getByRole('button', { name: '게임 초대 1개' }).click()
  const popover = page.getByRole('region', { name: '게임 초대함' })
  await expect(popover.getByText(accounts[0].nickname)).toBeVisible()
  const expired = await admin.from('game_invites').update({ expires_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', invite.id)
  if (expired.error) throw expired.error
  await popover.getByRole('button', { name: `${accounts[0].nickname} 초대 수락` }).click()

  await expect(popover.getByRole('alert')).toHaveText('초대가 만료됐어요.')
  await expect(popover.getByText('받은 초대가 없어요.')).toBeVisible()
})
