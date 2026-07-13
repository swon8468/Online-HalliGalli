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

test('두 브라우저가 로그인해 방 생성·코드 참여·준비·게임 시작을 동기화한다', async ({ browser }) => {
  const { password } = await connectedEnvironment()
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()
  const runtimeErrors: string[] = []
  for (const page of [host, guest]) {
    page.on('pageerror', error => runtimeErrors.push(error.message))
    await page.addInitScript(() => {
      Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: undefined })
      const trackedWindow = window as Window & { gameViewReads?: number }
      const originalFetch = window.fetch.bind(window)
      trackedWindow.gameViewReads = 0
      window.fetch = async (...args) => {
        const response = await originalFetch(...args)
        const input = args[0]
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (sessionStorage.getItem('delay-game-view') === 'true' && url.includes('/rest/v1/games?') && new URL(url).searchParams.get('select')?.includes('card_set_snapshot')) {
          trackedWindow.gameViewReads = (trackedWindow.gameViewReads ?? 0) + 1
          await new Promise(resolve => window.setTimeout(resolve, 1_200))
        }
        return response
      }
    })
  }

  try {
    await Promise.all([login(host, accounts[0].email, password), login(guest, accounts[1].email, password)])
    await host.goto('/create')
    let initialLobbyReads = 0
    await host.route('**/rest/v1/rooms?*', async route => {
      if (route.request().method() !== 'GET') return route.continue()
      initialLobbyReads += 1
      await new Promise(resolve => setTimeout(resolve, 1_200))
      await route.continue()
    })
    await host.getByRole('button', { name: '방 만들기', exact: true }).click()
    await expect(host).toHaveURL(/\/room\/[0-9a-f-]+$/)
    const code = (await host.locator('.room-code').innerText()).replace(/\s/g, '')
    expect(initialLobbyReads).toBe(1)
    await host.unroute('**/rest/v1/rooms?*')
    expect(code).toMatch(/^[A-Z]{3}[0-9]{3}$/)

    let heartbeatRequests = 0
    await host.route('**/rest/v1/rpc/heartbeat_room_session', async route => {
      heartbeatRequests += 1
      await new Promise(resolve => setTimeout(resolve, 250))
      await route.continue()
    })
    await host.evaluate(() => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('online'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => heartbeatRequests).toBe(1)
    await host.waitForTimeout(350)
    expect(heartbeatRequests).toBe(1)
    await host.unroute('**/rest/v1/rpc/heartbeat_room_session')

    await host.route('**/rest/v1/rpc/heartbeat_room_session', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'temporary heartbeat failure' }),
    }))
    await host.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(host.locator('.connection-banner')).toBeVisible()
    await host.unroute('**/rest/v1/rpc/heartbeat_room_session')
    await host.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(host.locator('.connection-banner')).toHaveCount(0)

    await host.evaluate(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
    })
    await host.getByRole('button', { name: '코드 복사' }).click()
    await expect(host.getByRole('button', { name: '복사했어요' })).toBeVisible()
    await host.waitForTimeout(1_000)
    await host.getByRole('button', { name: /초대 링크 공유/ }).click()
    await host.waitForTimeout(800)
    await expect(host.getByRole('button', { name: '복사했어요' })).toBeVisible()
    await host.waitForTimeout(900)
    await expect(host.getByRole('button', { name: '코드 복사' })).toBeVisible()

    await host.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError') } } })
      Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
    })
    await host.getByRole('button', { name: '코드 복사' }).click()
    await expect(host.getByRole('alert')).toContainText('초대 코드를 복사하지 못했어요.')

    await host.evaluate(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('cancelled', 'AbortError') } })
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('취소 후 복사하면 안 됩니다.') } } })
    })
    await host.getByRole('button', { name: /초대 링크 공유/ }).click()
    await expect(host.locator('.friends-notice')).toHaveText('공유를 취소했어요.')

    await host.evaluate(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
    })
    await host.getByRole('button', { name: /초대 링크 공유/ }).click()
    await expect(host.locator('.friends-notice')).toHaveText('초대 링크를 복사했어요.')

    await guest.goto(`/join?code=${code}`)
    await guest.getByRole('button', { name: /방 참여하기/ }).click()
    await expect(guest).toHaveURL(/\/room\/[0-9a-f-]+$/)
    await expect(host.getByText('E2E참가자', { exact: false })).toBeVisible()
    await guest.getByRole('button', { name: '준비하기' }).click()
    await expect(guest.getByRole('button', { name: /준비 완료/ })).toBeVisible()

    const start = host.getByRole('button', { name: '게임 시작', exact: true })
    await expect(start).toBeEnabled()
    await Promise.all([host.evaluate(() => sessionStorage.setItem('delay-game-view', 'true')), guest.evaluate(() => sessionStorage.setItem('delay-game-view', 'true'))])
    await start.click()
    await expect(host).toHaveURL(/\/game\?game=[0-9a-f-]+$/)
    await expect(guest).toHaveURL(/\/game\?game=[0-9a-f-]+$/)
    await expect(host.getByText('LIVE GAME')).toBeVisible()
    await expect(guest.getByText('LIVE GAME')).toBeVisible()
    expect(await host.evaluate(() => (window as Window & { gameViewReads?: number }).gameViewReads)).toBeGreaterThanOrEqual(1)
    expect(await host.evaluate(() => (window as Window & { gameViewReads?: number }).gameViewReads)).toBeLessThanOrEqual(2)
    expect(await guest.evaluate(() => (window as Window & { gameViewReads?: number }).gameViewReads ?? 0)).toBeLessThanOrEqual(2)
    expect(new URL(await host.url()).searchParams.get('game')).toBe(new URL(await guest.url()).searchParams.get('game'))

    const hostDeck = host.getByRole('button', { name: /눌러서 뒤집기/ })
    const guestDeck = guest.getByRole('button', { name: /눌러서 뒤집기/ })
    const hostStarts = await hostDeck.isEnabled()
    const activeDeck = hostStarts ? hostDeck : guestDeck
    const activePage = hostStarts ? host : guest
    await activeDeck.click()
    await expect(activePage.locator('.player-deck strong')).toHaveText('27')
    await expect(activePage.getByText('ROUND 2')).toBeVisible()
    expect(runtimeErrors).toEqual([])
  } finally {
    await hostContext.close(); await guestContext.close()
  }
})
