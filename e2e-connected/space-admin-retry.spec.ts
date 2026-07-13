import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('스페이스 관리 조회 실패를 같은 화면에서 복구한다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[0].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  let blocked = true
  let requests = 0
  await page.route('**/rest/v1/spaces?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000002' }) }))
  await page.route('**/functions/v1/space-admin', async route => {
    requests += 1
    if (blocked) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'temporary_space_failure' }) })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        actor: { id: '00000000-0000-4000-8000-000000000001', platformRole: 'super_admin', spaceRole: 'owner', canManage: true },
        data: {
          space: { id: '00000000-0000-4000-8000-000000000002', name: '복구 스페이스', slug: 'retry-space', description: null, status: 'active', join_code: 'A1B2C3D4', join_enabled: true, created_at: new Date().toISOString() },
          members: [], rooms: [], games: [], cardSets: [],
        },
      }),
    })
  })

  await page.goto('/spaces/retry-space/admin')
  await expect(page.getByRole('alert')).toContainText('스페이스를 불러오지 못했어요.')
  expect(requests).toBeGreaterThanOrEqual(1)
  blocked = false
  await page.getByRole('button', { name: '스페이스 다시 불러오기' }).click()
  await expect(page.getByRole('heading', { name: '복구 스페이스 관리' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
