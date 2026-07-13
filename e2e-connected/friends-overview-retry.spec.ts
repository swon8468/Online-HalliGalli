import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('친구 목록의 겹친 초기 요청을 합치고 실패 후 다시 불러온다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  let blocked = true
  let requests = 0
  await page.route('**/rest/v1/rpc/get_friends_overview', async route => {
    requests += 1
    await new Promise(resolve => setTimeout(resolve, 1_200))
    return blocked
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary friends failure' }) })
      : route.continue()
  })

  await page.goto('/friends')
  await expect(page.getByRole('alert')).toContainText('친구 정보를 처리하지 못했어요.')
  expect(requests).toBe(1)

  blocked = false
  await page.getByRole('button', { name: '다시 불러오기' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '내 친구' })).toBeVisible()
  expect(requests).toBe(2)
})
