import { expect, test, type Page } from '@playwright/test'
import { accounts, clearConnectedSessions, connectedEnvironment } from './fixture'

test.afterEach(async () => { await clearConnectedSessions() })

async function login(page: Page, email: string, password: string) {
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
}

test('두 브라우저 자동 매칭은 Realtime 준비 공백 없이 같은 게임으로 이동한다', async ({ browser }) => {
  const { password } = await connectedEnvironment()
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  const runtimeErrors: string[] = []
  for (const page of [first, second]) page.on('pageerror', error => runtimeErrors.push(error.message))

  try {
    await Promise.all([login(first, accounts[0].email, password), login(second, accounts[1].email, password)])
    let initialStatusRequests = 0
    await first.route('**/rest/v1/rpc/get_matchmaking_status', async route => {
      initialStatusRequests += 1
      await new Promise(resolve => setTimeout(resolve, 350))
      await route.continue()
    })
    await Promise.all([first.goto('/online'), second.goto('/online')])
    await expect(first.getByRole('button', { name: '매칭 시작' })).toBeEnabled()
    // One initial read is required. Auth hydration/StrictMode and the final
    // Postgres replication-ready reconciliation may add at most two reads, but
    // the count must settle instead of entering a refresh loop.
    await first.waitForTimeout(1_000)
    expect(initialStatusRequests).toBeGreaterThanOrEqual(1)
    expect(initialStatusRequests).toBeLessThanOrEqual(3)
    const settledStatusRequests = initialStatusRequests
    await first.waitForTimeout(500)
    expect(initialStatusRequests).toBe(settledStatusRequests)
    await first.unroute('**/rest/v1/rpc/get_matchmaking_status')
    for (const page of [first, second]) {
      await page.getByRole('button', { name: '2 명' }).click()
      await expect(page.getByRole('button', { name: '매칭 시작' })).toBeEnabled()
    }

    await Promise.all([
      first.getByRole('button', { name: '매칭 시작' }).click(),
      second.getByRole('button', { name: '매칭 시작' }).click(),
    ])
    await expect(first).toHaveURL(/\/game\?game=[0-9a-f-]+$/, { timeout: 15_000 })
    await expect(second).toHaveURL(/\/game\?game=[0-9a-f-]+$/, { timeout: 15_000 })
    const firstGame = new URL(first.url()).searchParams.get('game')
    const secondGame = new URL(second.url()).searchParams.get('game')
    expect(firstGame).toBe(secondGame)
    await expect(first.getByText('LIVE GAME')).toBeVisible()
    await expect(second.getByText('LIVE GAME')).toBeVisible()
    expect(runtimeErrors).toEqual([])
  } finally {
    await firstContext.close()
    await secondContext.close()
  }
})

test('취소 전에 시작한 늦은 heartbeat가 대기 상태를 되살리지 않는다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await login(page, accounts[1].email, password)
  await page.goto('/online')
  await page.getByRole('button', { name: '2 명' }).click()
  await page.getByRole('button', { name: '매칭 시작' }).click()
  await expect(page.getByRole('button', { name: '매칭 취소', exact: true }).last()).toBeEnabled()

  let heartbeatStarted = false
  await page.route('**/rest/v1/rpc/heartbeat_matchmaking', async route => {
    heartbeatStarted = true
    await new Promise(resolve => setTimeout(resolve, 1_200))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'waiting', playerCount: 2, queueCount: 1, members: [] }) })
  })
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => heartbeatStarted).toBe(true)
  await page.getByRole('button', { name: '매칭 취소', exact: true }).last().click()
  await expect(page.getByRole('button', { name: '매칭 시작' })).toBeEnabled()
  await page.waitForTimeout(1_300)
  await expect(page.getByRole('button', { name: '매칭 시작' })).toBeEnabled()
  await expect(page.getByText('플레이어를 찾고 있어요.')).toHaveCount(0)
})
