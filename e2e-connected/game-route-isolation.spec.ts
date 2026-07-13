import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('늦은 이전 게임 응답이 새 게임 화면을 덮어쓰지 않는다', async ({ page }) => {
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

  const firstGame = '00000000-0000-4000-8000-000000000601'
  const secondGame = '00000000-0000-4000-8000-000000000602'
  let firstStarted = false
  const gameRow = (gameId: string, cardCount: number) => ({
    room_id: gameId.replace(/6(01|02)$/, '700'),
    state: { phase: 'playing', round: cardCount, version: 1, currentTurn: actor.id, table: [], fruitTotals: { strawberry: 0, banana: 0, lime: 0, plum: 0 }, bellActive: false, winnerId: null },
    current_turn: actor.id,
    version: 1,
    card_set_id: null,
    card_set_version: null,
    card_set_snapshot: null,
  })
  const playerRow = (cardCount: number) => ({ user_id: actor.id, seat: 0, card_count: cardCount, eliminated_at: null, abandoned_at: null, rematch_requested_at: null, disconnected_at: null, last_seen_at: null, profiles: { nickname: 'E2E참가자' } })

  await page.route('**/rest/v1/games?*', async route => {
    const filter = new URL(route.request().url()).searchParams.get('id') ?? ''
    if (filter.includes(firstGame)) {
      firstStarted = true
      await new Promise(resolve => setTimeout(resolve, 1_200))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gameRow(firstGame, 21)) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gameRow(secondGame, 11)) })
  })
  await page.route('**/rest/v1/game_players?*', route => {
    const filter = new URL(route.request().url()).searchParams.get('game_id') ?? ''
    const count = filter.includes(firstGame) ? 21 : 11
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([playerRow(count)]) })
  })

  await page.goto(`/game?game=${firstGame}`)
  await expect.poll(() => firstStarted).toBe(true)
  await page.evaluate(gameId => {
    history.pushState({}, '', `/game?game=${gameId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, secondGame)

  await expect(page.locator('.player-deck strong')).toHaveText('11')
  await page.waitForTimeout(1_300)
  await expect(page).toHaveURL(new RegExp(`/game\\?game=${secondGame}$`))
  await expect(page.locator('.player-deck strong')).toHaveText('11')
  await expect(page.getByText('ROUND 21')).toHaveCount(0)
})

test('초기 게임 조회 실패를 같은 화면에서 다시 시도한다', async ({ page }) => {
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

  const gameId = '00000000-0000-4000-8000-000000000603'
  let blocked = true
  await page.route('**/rest/v1/games?*', route => blocked
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary game load failure' }) })
    : route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          room_id: '00000000-0000-4000-8000-000000000703',
          state: { phase: 'playing', round: 1, version: 1, currentTurn: actor.id, table: [], fruitTotals: { strawberry: 0, banana: 0, lime: 0, plum: 0 }, bellActive: false, winnerId: null },
          current_turn: actor.id, version: 1, card_set_id: null, card_set_version: null, card_set_snapshot: null,
        }),
      }))
  await page.route('**/rest/v1/game_players?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ user_id: actor.id, seat: 0, card_count: 13, eliminated_at: null, abandoned_at: null, rematch_requested_at: null, disconnected_at: null, last_seen_at: null, profiles: { nickname: 'E2E참가자' } }]),
  }))

  await page.goto(`/game?game=${gameId}`)
  await expect(page.getByRole('alert')).toContainText('게임 상태를 불러오지 못했어요.', { timeout: 12_000 })
  blocked = false
  await page.getByRole('button', { name: '다시 불러오기' }).click()
  await expect(page.getByText('LIVE GAME')).toBeVisible()
  await expect(page.locator('.player-deck strong')).toHaveText('13')
})
