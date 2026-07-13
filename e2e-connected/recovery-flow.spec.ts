import { expect, test, type Page } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

const recoveryEndpoint = '**/auth/v1/recover*'

async function fillRecoveryEmail(page: Page, email = accounts[0].email) {
  await page.goto('/recover')
  await page.getByLabel('이메일').fill(email)
  await page.getByRole('button', { name: /복구 안내 받기/ }).click()
}

async function login(page: Page) {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[0].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
}

test('복구 API 실패는 성공 화면으로 이동하지 않고 한글 오류를 표시한다', async ({ page }) => {
  await page.route(recoveryEndpoint, route => route.fulfill({
    status: 429,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'rate limit exceeded' }),
  }))

  await fillRecoveryEmail(page)

  await expect(page).toHaveURL('/recover')
  await expect(page.getByRole('alert')).toHaveText('요청이 너무 많아요. 잠시 후 다시 시도해 주세요.')
  await expect(page.getByRole('heading', { name: '계정에 다시 접속해요.' })).toBeVisible()
})

test('성공한 복구 요청은 별도 화면에서 유지되고 같은 주소의 중복 전송을 막는다', async ({ page }) => {
  let requestCount = 0
  await page.route(recoveryEndpoint, route => {
    requestCount += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await fillRecoveryEmail(page)
  await expect(page).toHaveURL('/recover/sent')
  await expect(page.getByRole('heading', { name: '메일을 확인해 주세요.' })).toBeVisible()
  expect(requestCount).toBe(1)

  await page.reload()
  await expect(page).toHaveURL('/recover/sent')
  await expect(page.getByText('중복 요청을 막기 위해 이 화면에서는 다시 전송하지 않습니다.')).toBeVisible()

  await fillRecoveryEmail(page)
  await expect(page).toHaveURL('/recover/sent')
  expect(requestCount).toBe(1)

  await page.evaluate(() => {
    sessionStorage.clear()
    history.replaceState(null, '', '/recover/sent')
  })
  await page.reload()
  await expect(page).toHaveURL('/recover')
})

test('다른 이메일의 복구 요청은 기존 주소의 60초 제한에 막히지 않는다', async ({ page }) => {
  let requestCount = 0
  await page.route(recoveryEndpoint, route => {
    requestCount += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await fillRecoveryEmail(page, accounts[0].email)
  await expect(page).toHaveURL('/recover/sent')
  await fillRecoveryEmail(page, accounts[1].email)
  await expect(page).toHaveURL('/recover/sent')
  expect(requestCount).toBe(2)
})

test('기존 로그인 세션은 토큰 없는 복구 주소를 유효하게 만들지 않는다', async ({ page }) => {
  await login(page)
  await page.goto('/recover?type=recovery')

  await expect(page.getByRole('heading', { name: '재설정 링크를 사용할 수 없어요.' })).toBeVisible({ timeout: 4_000 })
  await expect(page.getByLabel('새 비밀번호', { exact: true })).toHaveCount(0)
})

test('Supabase가 발급한 실제 복구 링크는 새 비밀번호 화면을 연다', async ({ page }, testInfo) => {
  const { admin } = await connectedEnvironment()
  const redirectTo = `${testInfo.project.use.baseURL}/recover?type=recovery`
  const generated = await admin.auth.admin.generateLink({ type: 'recovery', email: accounts[0].email, options: { redirectTo } })
  if (generated.error) throw generated.error
  const actionLink = generated.data.properties.action_link

  await page.goto(actionLink)

  await expect(page).toHaveURL(/\/recover\?type=recovery/)
  await expect(page.getByLabel('새 비밀번호', { exact: true })).toBeVisible({ timeout: 8_000 })
  await expect(page.getByLabel('새 비밀번호 확인')).toBeVisible()
})
