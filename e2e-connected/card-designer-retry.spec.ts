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

test('이전 카드 세트의 늦은 저장 완료가 새 디자이너 화면에 섞이지 않는다', async ({ page }) => {
  const { admin, password } = await connectedEnvironment()
  const defaultSet = await admin.from('card_sets').select('id,name').eq('is_platform_default', true).single()
  if (defaultSet.error || !defaultSet.data) throw defaultSet.error ?? new Error('기본 카드 세트가 없습니다.')

  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[0].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  await page.goto('/cards')
  await page.getByRole('button', { name: '새 카드 세트' }).click()
  await page.getByLabel('이름').fill('E2E 저장 격리 카드')
  await page.getByRole('dialog').getByRole('button', { name: '생성', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('초안 카드 세트를 만들었어요.')

  const card = page.locator('.card-library-grid article').filter({ hasText: 'E2E 저장 격리 카드' })
  const editHref = await card.getByRole('link', { name: '편집' }).getAttribute('href')
  if (!editHref) throw new Error('생성한 카드 세트 주소를 찾지 못했습니다.')
  const createdId = decodeURIComponent(editHref.split('/').pop() ?? '')

  let saveStarted = false
  await page.route('**/rest/v1/card_sets?*', async route => {
    const request = route.request()
    const target = new URL(request.url()).searchParams.get('id') ?? ''
    if (request.method() === 'PATCH' && target.includes(createdId)) {
      saveStarted = true
      await new Promise(resolve => setTimeout(resolve, 1_200))
    }
    await route.continue()
  })

  await page.goto(editHref)
  const nameInput = page.getByLabel('카드 세트 이름')
  await expect(nameInput).toHaveValue('E2E 저장 격리 카드')
  await nameInput.fill('E2E 늦은 저장 카드')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect.poll(() => saveStarted).toBe(true)

  await page.evaluate(cardSetId => {
    history.pushState({}, '', `/cards/${encodeURIComponent(cardSetId)}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, defaultSet.data.id)
  await expect(nameInput).toHaveValue(defaultSet.data.name)
  await page.waitForTimeout(1_300)
  await expect(nameInput).toHaveValue(defaultSet.data.name)
  await expect(page.getByText('초안을 저장했어요.')).toHaveCount(0)
  await expect(page).toHaveURL(`/cards/${defaultSet.data.id}`)
})
