import { expect, test, type Page } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

async function login(page: Page, email: string) {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
}

test('이전 계정의 늦은 초대 응답을 새 계정에 표시하지 않는다', async ({ page }) => {
  let requestCount = 0
  let firstStarted = false
  let releaseFirst: (() => void) | undefined
  const firstPending = new Promise<void>(resolve => { releaseFirst = resolve })
  const oldInvite = {
    id: '00000000-0000-4000-8000-000000000401',
    roomId: '00000000-0000-4000-8000-000000000402',
    roomCode: 'OLD401',
    roomStatus: 'waiting',
    userId: '00000000-0000-4000-8000-000000000403',
    nickname: '이전계정초대',
    friendTag: 'OLD#0403',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  }

  await page.route('**/rest/v1/rpc/get_game_invites', async route => {
    requestCount += 1
    if (requestCount === 1) {
      firstStarted = true
      await firstPending
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ received: [oldInvite], sent: [] }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ received: [], sent: [] }) })
  })

  await login(page, accounts[0].email)
  await expect.poll(() => firstStarted).toBe(true)
  await page.goto('/account')
  await page.getByRole('button', { name: /이 기기에서 로그아웃/ }).click()
  await expect(page).toHaveURL(/\/auth\?next=%2Faccount$/)
  await login(page, accounts[1].email)
  await expect.poll(() => requestCount).toBeGreaterThanOrEqual(2)

  releaseFirst?.()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '게임 초대 0개' }).click()
  await expect(page.getByText('받은 초대가 없어요.')).toBeVisible()
  await expect(page.getByText('이전계정초대')).toHaveCount(0)
})
