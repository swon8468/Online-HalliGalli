import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('관리자 스냅샷 조회 실패를 대시보드에서 다시 시도한다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[0].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  let blocked = true
  let requests = 0
  await page.route('**/functions/v1/admin-actions', async route => {
    requests += 1
    if (blocked) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'snapshot_unavailable' }) })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        actor: { id: '00000000-0000-4000-8000-000000000001', nickname: 'E2E방장', role: 'super_admin' },
        data: { profiles: [], rooms: [], spaces: [], cardSets: [], audit: [] },
      }),
    })
  })

  await page.goto('/admin')
  await expect(page.getByRole('alert')).toContainText('관리자 데이터를 불러오지 못했습니다.')
  expect(requests).toBeGreaterThanOrEqual(1)
  blocked = false
  await page.getByRole('button', { name: '관리자 데이터 다시 불러오기' }).click()
  await expect(page.locator('.admin-header h1')).toHaveText('대시보드')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('관리자 대시보드 링크가 실제 카드와 스페이스 관리 화면을 연다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[0].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  await page.route('**/functions/v1/admin-actions', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      actor: { id: '00000000-0000-4000-8000-000000000001', nickname: 'E2E방장', role: 'super_admin' },
      data: { profiles: [], rooms: [], spaces: [], cardSets: [], audit: [] },
    }),
  }))

  await page.goto('/admin')
  await page.getByRole('button', { name: '카드 디자인' }).click()
  await page.getByRole('link', { name: /카드 스튜디오/ }).click()
  await expect(page).toHaveURL(/\/(?:admin\/)?cards$/)
  await expect(page.getByRole('heading', { name: '게임의 표정을 디자인해요.' })).toBeVisible()
  await page.getByRole('link', { name: '관리자 콘솔로' }).click()
  await expect(page).toHaveURL('/admin')
  await expect(page.locator('.admin-header h1')).toHaveText('대시보드')

  await page.getByRole('button', { name: '스페이스' }).click()
  await page.getByRole('link', { name: /스페이스 생성/ }).click()
  await expect(page).toHaveURL(/\/(?:admin\/)?spaces$/)
  await expect(page.getByRole('heading', { name: '함께 운영할 공간이에요.' })).toBeVisible()
})
