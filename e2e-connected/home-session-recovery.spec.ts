import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('홈의 진행 중 세션 조회 실패는 안내되고 같은 화면에서 복구된다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  let blocked = true
  let lookupRequests = 0
  await page.route('**/rest/v1/rpc/get_my_active_session', route => {
    lookupRequests += 1
    return blocked
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary active session failure' }) })
      : route.continue()
  })

  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('진행 중인 게임을 확인하지 못했어요.', { timeout: 12_000 })
  expect(lookupRequests).toBe(1)

  blocked = false
  await page.getByRole('button', { name: '다시 확인' }).click()
  await expect(alert).toHaveCount(0)
  await expect(page.getByRole('region', { name: '게임 메뉴' })).toBeVisible()
})
