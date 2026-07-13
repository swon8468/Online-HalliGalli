import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('게임 ID 없는 직접 접근은 세션 조회 실패를 복구하고 빈 상태를 안내한다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  let blocked = true
  let requests = 0
  await page.route('**/rest/v1/rpc/get_my_active_session', async route => {
    requests += 1
    await new Promise(resolve => setTimeout(resolve, 1_000))
    return blocked
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary game session failure' }) })
      : route.continue()
  })

  await page.goto('/game')
  await expect(page.getByRole('alert')).toContainText('진행 중인 게임을 확인하지 못했어요.')
  expect(requests).toBe(1)

  blocked = false
  await page.getByRole('button', { name: '다시 확인' }).click()
  await expect(page.getByRole('status')).toContainText('진행 중인 게임이 없어요.')
  expect(requests).toBe(2)
  await page.getByRole('button', { name: '홈으로 돌아가기' }).click()
  await expect(page).toHaveURL('/')
})
