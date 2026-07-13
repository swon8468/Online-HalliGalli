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

test('방 옵션 조회 실패는 생성을 막고 각 목록을 재시도한다', async ({ page }) => {
  const fakeSpaceId = '11111111-1111-4111-8111-111111111111'
  let spacesFail = true
  let cardSetsFail = true
  await login(page)
  await page.route('**/rest/v1/space_members?*', route => spacesFail
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary spaces failure' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ role: 'member', spaces: { id: fakeSpaceId, name: '테스트 단체', slug: 'test-group', status: 'active', description: null } }]) }))
  await page.route('**/rest/v1/card_sets?*', route => cardSetsFail
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary card sets failure' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/create')
  await expect(page.getByRole('alert')).toContainText('게임 공간 목록을 불러오지 못했어요.', { timeout: 12_000 })
  await expect(page.getByRole('button', { name: '방 옵션 확인 중...' })).toBeDisabled()

  spacesFail = false
  await page.getByRole('button', { name: '게임 공간 다시 불러오기' }).click()
  const spaceSelect = page.getByLabel('게임 공간')
  await expect(spaceSelect).toBeVisible()
  await spaceSelect.selectOption(fakeSpaceId)
  await expect(page.getByRole('alert')).toContainText('카드 세트 목록을 불러오지 못했어요.', { timeout: 12_000 })
  await expect(page.getByRole('button', { name: '방 옵션 확인 중...' })).toBeDisabled()

  cardSetsFail = false
  await page.getByRole('button', { name: '카드 세트 다시 불러오기' }).click()
  await expect(page.getByLabel('카드 세트')).toBeEnabled()
  await expect(page.getByRole('button', { name: '방 만들기', exact: true })).toBeEnabled()
})
