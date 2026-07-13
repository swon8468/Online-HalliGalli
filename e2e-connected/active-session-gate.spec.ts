import { expect, test, type Page } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

async function login(page: Page) {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
}

test('진행 중 세션 조회가 실패하면 새 세션 진입을 차단하고 재시도한다', async ({ page }) => {
  let blocked = true
  await login(page)
  await page.route('**/rest/v1/rpc/get_my_active_session', route => blocked
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary session lookup failure' }) })
    : route.continue())

  await page.goto('/create')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('진행 중인 게임을 확인하지 못했어요.', { timeout: 12_000 })
  await expect(page.getByRole('button', { name: '방 만들기', exact: true })).toHaveCount(0)

  blocked = false
  await page.getByRole('button', { name: '다시 확인' }).click()
  await expect(page.getByRole('heading', { name: '새 게임을 준비할게요.' })).toBeVisible()
  await expect(page.getByRole('button', { name: '방 만들기', exact: true })).toBeEnabled()
})
