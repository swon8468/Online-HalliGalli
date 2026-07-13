import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

async function login(page: import('@playwright/test').Page) {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[0].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
}

test('스페이스 목록 조회 실패를 같은 화면에서 다시 시도한다', async ({ page }) => {
  await login(page)
  let blocked = true
  let requests = 0
  await page.route('**/rest/v1/space_members?*', async route => {
    requests += 1
    return blocked ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'spaces request rejected' }) }) : route.continue()
  })
  await page.goto('/spaces')
  await expect(page.getByRole('alert')).toContainText('스페이스를 불러오지 못했어요.')
  expect(requests).toBeGreaterThanOrEqual(1)
  blocked = false
  await page.getByRole('button', { name: '스페이스 다시 불러오기' }).click()
  await expect(page.getByRole('heading', { name: '내 스페이스' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('카드 세트 목록 조회 실패를 같은 화면에서 다시 시도한다', async ({ page }) => {
  await login(page)
  let blocked = true
  let requests = 0
  await page.route('**/rest/v1/card_sets?*', async route => {
    requests += 1
    return blocked ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'cards request rejected' }) }) : route.continue()
  })
  await page.goto('/cards')
  await expect(page.getByRole('alert')).toContainText('카드 세트를 불러오지 못했어요.')
  expect(requests).toBeGreaterThanOrEqual(1)
  blocked = false
  await page.getByRole('button', { name: '카드 세트 다시 불러오기' }).click()
  await expect(page.getByText('사용 가능한 카드 라이브러리')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('늦은 이전 스페이스 카드 응답이 새 스페이스 목록을 덮어쓰지 않는다', async ({ page }) => {
  await login(page)
  const firstSpace = '00000000-0000-4000-8000-000000000011'
  const secondSpace = '00000000-0000-4000-8000-000000000022'
  let firstStarted = false
  const row = (id: string, name: string, spaceId: string) => ({
    id, name, description: null, status: 'draft', version: 1, is_platform_default: false,
    space_id: spaceId, back_asset_path: null, back_design: {}, updated_at: new Date().toISOString(), spaces: null,
  })
  await page.route('**/rest/v1/card_sets?*', async route => {
    const filter = new URL(route.request().url()).searchParams.get('or') ?? ''
    if (filter.includes(firstSpace)) {
      firstStarted = true
      await new Promise(resolve => setTimeout(resolve, 1_200))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row('00000000-0000-4000-8000-000000000111', '이전 스페이스 카드', firstSpace)]) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row('00000000-0000-4000-8000-000000000222', '최신 스페이스 카드', secondSpace)]) })
  })

  await page.goto(`/cards?space=${firstSpace}`)
  await expect.poll(() => firstStarted).toBe(true)
  await page.evaluate(spaceId => {
    history.pushState({}, '', `/cards?space=${spaceId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, secondSpace)
  await expect(page.getByText('최신 스페이스 카드')).toBeVisible()
  await page.waitForTimeout(1_300)
  await expect(page.getByText('최신 스페이스 카드')).toBeVisible()
  await expect(page.getByText('이전 스페이스 카드')).toHaveCount(0)
})
