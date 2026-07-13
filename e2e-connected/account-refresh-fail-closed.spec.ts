import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('프로필 저장 후 사용자 재검증 실패는 로컬 인증 토큰을 남기지 않는다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: '내 계정을 관리해요.' })).toBeVisible()

  await page.route('**/rest/v1/profiles?*', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 204, body: '' })
    : route.continue())
  let userChecks = 0
  await page.route('**/auth/v1/user', route => {
    if (route.request().method() !== 'GET') return route.continue()
    userChecks += 1
    return userChecks === 1
      ? route.continue()
      : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'user verification failed' }) })
  })

  await page.getByRole('button', { name: '프로필 저장' }).click()
  await expect(page).toHaveURL(/\/auth\?next=%2Faccount/)
  expect(userChecks).toBe(2)
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.includes('auth-token')))).toBe(false)
})
