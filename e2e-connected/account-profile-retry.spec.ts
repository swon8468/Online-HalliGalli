import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('계정 프로필 조회 실패는 무한 로딩 대신 재시도 상태를 표시한다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  let blocked = true
  await page.route('**/rest/v1/profiles*', route => blocked
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary account profile failure' }) })
    : route.continue())
  await page.getByRole('link', { name: 'E2E참가자 계정 관리' }).click()
  await expect(page).toHaveURL('/account')

  await expect(page.getByRole('button', { name: '프로필 다시 불러오기' })).toBeVisible({ timeout: 12_000 })
  await expect(page.getByText('프로필을 불러오는 중...')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('프로필을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')

  blocked = false
  await page.getByRole('button', { name: '프로필 다시 불러오기' }).click()
  await expect(page.getByLabel('닉네임')).toHaveValue('E2E참가자')
  await expect(page.getByRole('button', { name: '프로필 다시 불러오기' })).toHaveCount(0)
})
