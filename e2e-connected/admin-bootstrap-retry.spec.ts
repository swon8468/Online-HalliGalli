import { expect, test } from '@playwright/test'

test('로컬 관리자 경로에서 부트스트랩 상태 실패를 다시 확인한다', async ({ page }) => {
  let blocked = true
  await page.route('**/functions/v1/bootstrap-super-admin', route => blocked
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'server_not_configured' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: false }) }))

  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: '관리자 로그인' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('최초 관리자 상태를 확인하지 못했습니다.')
  blocked = false
  await page.getByRole('button', { name: '다시 확인' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /안전하게 로그인/ })).toBeEnabled()
})

test('부트스트랩 생성 네트워크 실패 후 폼을 다시 사용할 수 있다', async ({ page }) => {
  await page.route('**/functions/v1/bootstrap-super-admin', async route => {
    const action = (route.request().postDataJSON() as { action?: string }).action
    if (action === 'status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) })
    return route.abort('failed')
  })

  await page.goto('/admin')
  await page.getByRole('button', { name: /최초 슈퍼 관리자 생성/ }).click()
  await page.getByLabel('관리자 이메일').fill('bootstrap-failure@swonport.kr')
  await page.getByLabel('표시 이름').fill('복구관리자')
  await page.getByLabel('비밀번호').fill('BootstrapFailure2026!')
  await page.getByLabel('부트스트랩 비밀값').fill('not-a-real-secret')
  await page.getByRole('button', { name: '슈퍼 관리자 생성' }).click()

  await expect(page.getByRole('alert')).toContainText('슈퍼 관리자를 생성하지 못했습니다.')
  await expect(page.getByRole('button', { name: '슈퍼 관리자 생성' })).toBeEnabled()
})
