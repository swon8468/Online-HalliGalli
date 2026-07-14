import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('프로필 상태를 확인할 수 없으면 로그인 세션을 닫고 재시도를 허용한다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  let blocked = true

  await page.route('**/rest/v1/profiles*', async route => {
    if (!blocked) return route.continue()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST000', message: 'temporary profile failure' }),
    })
  })

  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()

  await expect(page).toHaveURL(/\/auth(?:\?|$)/)
  await expect(page.getByRole('alert')).toHaveText('계정 상태를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.', { timeout: 12_000 })
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.includes('auth-token')))).toBe(false)

  blocked = false
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('link', { name: 'E2E참가자 계정 관리' })).toBeVisible()
})
