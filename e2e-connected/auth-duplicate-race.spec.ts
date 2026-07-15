import { expect, test } from '@playwright/test'

async function openSignup(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.getByRole('button', { name: '가입하기', exact: true }).click()
}

test('중복 확인 전 가입을 막고 확인 중 전체 입력을 잠근 뒤 사용 가능한 이메일을 유지한다', async ({ page }) => {
  let checkStarted = false
  let releaseCheck: (() => void) | undefined
  const pending = new Promise<void>(resolve => { releaseCheck = resolve })
  await page.route('**/functions/v1/check-identifier', async route => {
    checkStarted = true
    await pending
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) })
  })

  await openSignup(page)
  const email = page.getByLabel('이메일')
  const nickname = page.getByLabel('닉네임')
  const password = page.getByLabel('비밀번호', { exact: true })
  const passwordConfirm = page.getByLabel('비밀번호 확인')
  const createAccount = page.getByRole('button', { name: /^계정 만들기/ })
  await nickname.fill('중복확인사용자')
  await email.fill('available-check@swonport.kr')
  await password.fill('DuplicateCheck2026!')
  await passwordConfirm.fill('DuplicateCheck2026!')
  await expect(createAccount).toBeDisabled()

  await page.getByRole('button', { name: '중복 확인' }).click()
  await expect.poll(() => checkStarted).toBe(true)
  await expect(page.getByText('중복 확인 중이에요.')).toBeVisible()
  await expect(page.getByText('확인이 끝날 때까지 잠시 기다려 주세요.')).toBeVisible()
  await expect(email).toBeDisabled()
  await expect(nickname).toBeDisabled()
  await expect(password).toBeDisabled()
  await expect(passwordConfirm).toBeDisabled()
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeDisabled()
  await expect(createAccount).toBeDisabled()
  releaseCheck?.()

  await expect(page.getByText('중복 확인 중이에요.')).toHaveCount(0)
  await expect(page.getByText('사용할 수 있어요.')).toBeVisible()
  await expect(email).toBeDisabled()
  await expect(nickname).toBeEnabled()
  await expect(password).toBeEnabled()
  await expect(createAccount).toBeEnabled()
  await page.getByRole('button', { name: '다시 입력' }).click()
  await expect(email).toBeEnabled()
  await expect(page.getByText('사용할 수 있어요.')).toHaveCount(0)
  await expect(createAccount).toBeDisabled()
})

test('중복 이메일이면 확인 종료 후 입력을 다시 허용한다', async ({ page }) => {
  await page.route('**/functions/v1/check-identifier', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ available: false }),
  }))
  await openSignup(page)
  const email = page.getByLabel('이메일')
  await email.fill('already-used@swonport.kr')
  await page.getByRole('button', { name: '중복 확인' }).click()

  await expect(page.getByText('이미 사용 중인 이메일이에요.')).toBeVisible()
  await expect(email).toBeEnabled()
  await expect(page.getByLabel('닉네임')).toBeEnabled()
  await expect(page.getByRole('button', { name: /^계정 만들기/ })).toBeDisabled()
})

test('중복 확인 네트워크 실패 후 다시 시도할 수 있다', async ({ page }) => {
  await page.route('**/functions/v1/check-identifier', route => route.abort('failed'))
  await openSignup(page)
  await page.getByLabel('이메일').fill('network-failure@swonport.kr')
  await page.getByRole('button', { name: '중복 확인' }).click()

  await expect(page.getByText('중복 확인에 실패했어요. 잠시 후 다시 시도해 주세요.')).toBeVisible()
  await expect(page.getByLabel('이메일')).toBeEnabled()
  await expect(page.getByRole('button', { name: '중복 확인' })).toBeEnabled()
})
