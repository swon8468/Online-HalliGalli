import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('늦은 이전 방 응답이 새 방 화면을 덮어쓰지 않는다', async ({ page }) => {
  const { admin, password } = await connectedEnvironment()
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 100 })
  if (listed.error) throw listed.error
  const actor = listed.data.users.find(user => user.email === accounts[1].email)
  if (!actor) throw new Error('브라우저 테스트 계정을 찾지 못했습니다.')

  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const firstRoom = '00000000-0000-4000-8000-000000000501'
  const secondRoom = '00000000-0000-4000-8000-000000000502'
  let firstStarted = false
  const roomRow = (id: string, code: string) => ({ id, code, max_players: 4, status: 'waiting', host_id: actor.id })
  const memberRow = { user_id: actor.id, role: 'host', seat: 0, disconnected_at: null, left_at: null, is_ready: true, profiles: { nickname: 'E2E참가자' } }

  await page.route('**/rest/v1/rooms?*', async route => {
    const filter = new URL(route.request().url()).searchParams.get('id') ?? ''
    if (filter.includes(firstRoom)) {
      firstStarted = true
      await new Promise(resolve => setTimeout(resolve, 1_200))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roomRow(firstRoom, 'OLD501')) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roomRow(secondRoom, 'NEW502')) })
  })
  await page.route('**/rest/v1/room_members?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([memberRow]) }))

  await page.goto(`/room/${firstRoom}`)
  await expect.poll(() => firstStarted).toBe(true)
  await page.evaluate(roomId => {
    history.pushState({}, '', `/room/${roomId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, secondRoom)

  await expect(page.locator('.room-code')).toContainText('NEW502')
  await page.waitForTimeout(1_300)
  await expect(page).toHaveURL(new RegExp(`/room/${secondRoom}$`))
  await expect(page.locator('.room-code')).toContainText('NEW502')
  await expect(page.getByText('OLD501')).toHaveCount(0)
})
