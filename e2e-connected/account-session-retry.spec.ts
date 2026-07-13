import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('계정의 진행 중 게임 조회 실패도 같은 카드에서 재시도한다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  let blocked = true
  let requests = 0
  await page.route('**/rest/v1/rpc/get_my_active_session', route => {
    requests += 1
    return blocked
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary account session failure' }) })
      : route.continue()
  })
  await page.getByRole('link', { name: 'E2E참가자 계정 관리' }).click()
  await expect(page).toHaveURL('/account')
  await expect(page.getByText('진행 중인 게임을 확인하지 못했어요.')).toBeVisible()
  expect(requests).toBe(1)

  blocked = false
  await page.getByRole('button', { name: '다시 확인' }).click()
  await expect(page.getByText('진행 중인 게임을 확인하지 못했어요.')).toHaveCount(0)
  await expect(page.getByText('진행 중인 게임을 확인하고 있어요.')).toHaveCount(0)
})
