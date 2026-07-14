import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('늦게 도착한 이전 친구 검색 결과가 최신 검색을 덮어쓰지 않는다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  await page.route('**/rest/v1/rpc/search_friend_users', async route => {
    const query = (route.request().postDataJSON() as { p_query?: string }).p_query
    if (query === '느린') await new Promise(resolve => setTimeout(resolve, 1_200))
    const nickname = query === '느린' ? '느린사용자' : '최신사용자'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ user_id: query === '느린' ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002', nickname, friend_tag: query === '느린' ? 'SLOW#0001' : 'NEW#0002', avatar_seed: nickname, relationship: 'none', activity: 'idle' }]),
    })
  })

  await page.goto('/friends')
  const search = page.getByLabel('친구 닉네임 또는 태그')
  await search.fill('느린')
  await page.getByRole('button', { name: '친구 검색' }).click()
  await search.fill('최신')
  await page.getByRole('button', { name: '친구 검색' }).click()

  await expect(page.getByText('최신사용자')).toBeVisible()
  await page.waitForTimeout(1_300)
  await expect(page.getByText('최신사용자')).toBeVisible()
  await expect(page.getByText('느린사용자')).toHaveCount(0)
})
