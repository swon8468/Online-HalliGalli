import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('카드 디자이너 초기 조회 실패를 같은 주소에서 다시 시도한다', async ({ page }) => {
  const { admin, password } = await connectedEnvironment()
  const cardSet = await admin.from('card_sets').select('id,name').order('is_platform_default', { ascending: false }).limit(1).single()
  if (cardSet.error || !cardSet.data) throw cardSet.error ?? new Error('테스트할 카드 세트가 없습니다.')

  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[0].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  let blocked = true
  let requests = 0
  await page.route('**/rest/v1/card_sets?*', route => {
    requests += 1
    return blocked
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'card designer request rejected' }) })
      : route.continue()
  })

  await page.goto(`/cards/${encodeURIComponent(cardSet.data.id)}`)
  await expect(page.getByRole('alert')).toContainText('카드 세트를 불러오지 못했어요.')
  expect(requests).toBeGreaterThanOrEqual(1)
  blocked = false
  await page.getByRole('button', { name: '카드 세트 다시 불러오기' }).click()
  await expect(page.getByLabel('카드 세트 이름')).toHaveValue(cardSet.data.name)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
