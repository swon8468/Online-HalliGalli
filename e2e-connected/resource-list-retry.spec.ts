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
