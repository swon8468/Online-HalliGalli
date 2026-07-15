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

function overview(id: string, slug: string, name: string) {
  return {
    ok: true,
    actor: { id: '00000000-0000-4000-8000-000000000001', platformRole: 'super_admin', spaceRole: 'owner', canView: true, canManage: true, canOwn: true, piiMasked: false },
    data: {
      space: { id, name, slug, description: null, status: 'active', join_code: 'A1B2C3D4', join_enabled: true, join_policy: 'code', join_code_expires_at: null, allowed_email_domains: ['@swonport.kr'], created_at: new Date().toISOString() },
      metrics: { members: 1, rooms: 0, activeRooms: 0, games: 0, finishedGames: 0, cardSets: 0, audit: 0 },
    },
  }
}

test('스페이스 관리 조회 실패를 같은 화면에서 복구한다', async ({ page }) => {
  await login(page)
  let blocked = true
  let requests = 0
  await page.route('**/functions/v1/space-admin', route => {
    requests += 1
    if (blocked) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'temporary_space_failure' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview('00000000-0000-4000-8000-000000000002', 'retry-space', '복구 스페이스')) })
  })

  await page.goto('/spaces/retry-space/admin')
  await expect(page.getByRole('alert')).toContainText('temporary_space_failure')
  expect(requests).toBeGreaterThanOrEqual(1)
  blocked = false
  await page.getByRole('button', { name: '스페이스 다시 불러오기' }).click()
  await expect(page.getByRole('heading', { name: '복구 스페이스' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('이전 스페이스의 늦은 계정 생성 결과와 임시 비밀번호를 새 스페이스에 노출하지 않는다', async ({ page }) => {
  await login(page)
  const firstId = '00000000-0000-4000-8000-000000000031'
  const secondId = '00000000-0000-4000-8000-000000000032'
  let createStarted = false

  await page.route('**/functions/v1/space-admin', async route => {
    const body = route.request().postDataJSON() as { action?: string; spaceId?: string; slug?: string }
    if (body.action === 'create_account') {
      createStarted = true
      await new Promise(resolve => setTimeout(resolve, 1_200))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, account: { userId: '00000000-0000-4000-8000-000000000099', email: 'old-space@swonport.kr', nickname: '이전계정', role: 'member', password: 'Temporary-Secret-123!', created: true } }) })
    }
    if (body.action === 'members_page') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, actor: overview(firstId, 'first-space', '첫 번째 스페이스').actor, data: { items: [], page: 1, pageSize: 25, total: 0 } }) })
    const isSecond = body.slug === 'second-space' || body.spaceId === secondId
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview(isSecond ? secondId : firstId, isSecond ? 'second-space' : 'first-space', isSecond ? '두 번째 스페이스' : '첫 번째 스페이스')) })
  })

  await page.goto('/spaces/first-space/admin')
  await expect(page.getByRole('heading', { name: '첫 번째 스페이스' })).toBeVisible()
  await page.getByRole('button', { name: '멤버', exact: true }).click()
  await page.getByRole('button', { name: '멤버 추가' }).click()
  const dialog = page.getByRole('dialog', { name: '멤버 추가' })
  await dialog.getByRole('button', { name: '전용 계정' }).click()
  await dialog.getByLabel('이메일').fill('old-space@swonport.kr')
  await dialog.getByLabel('표시 이름').fill('이전계정')
  await dialog.getByRole('button', { name: '계정 생성', exact: true }).click()
  await expect.poll(() => createStarted).toBe(true)

  await page.evaluate(() => { history.pushState({}, '', '/spaces/second-space/admin'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.getByRole('heading', { name: '두 번째 스페이스' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.waitForTimeout(1_300)
  await expect(page.getByText('old-space@swonport.kr')).toHaveCount(0)
  await expect(page.getByText('Temporary-Secret-123!')).toHaveCount(0)
  await expect(page).toHaveURL('/spaces/second-space/admin')
})
