import { expect, test, type Page } from '@playwright/test'

function watchRuntimeErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text()) })
  return errors
}

test('공개 홈과 핵심 메뉴가 오류 없이 열린다', async ({ page }) => {
  const errors = watchRuntimeErrors(page)
  await page.goto('/')
  await expect(page).toHaveTitle('Halli Galli Online')
  await expect(page.getByRole('heading', { name: /다섯이 되는 순간/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '게임 메뉴' }).getByRole('link')).toHaveCount(6)
  await page.getByRole('link', { name: /게임 룰 종을/ }).click()
  await expect(page.getByRole('heading', { name: '규칙은 간단해요.' })).toBeVisible()
  expect(errors).toEqual([])
})

test('placeholder 환경값은 Supabase로 오인되지 않고 보호 경로가 로그인으로 이동한다', async ({ page }) => {
  const errors = watchRuntimeErrors(page)
  await page.goto('/create')
  await expect(page).toHaveURL(/\/auth\?next=%2Fcreate$/)
  await expect(page.getByText('개발용 데모 인증이 활성화되어 있어요.')).toBeVisible()
  await page.getByLabel('이메일').fill('demo@local.test')
  await page.getByLabel('비밀번호').fill('DemoPassword2026!')
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/create')
  await expect(page.getByRole('heading', { name: '새 게임을 준비할게요.' })).toBeVisible()
  expect(errors).toEqual([])
})

test('데모 회원가입의 중복 확인과 비밀번호 확인 흐름이 동작한다', async ({ page }) => {
  const errors = watchRuntimeErrors(page)
  await page.goto('/auth')
  await page.getByRole('button', { name: '가입하기' }).click()
  await page.getByLabel('닉네임').fill('E2E사용자')
  await page.getByLabel('이메일').fill('signup@local.test')
  await page.getByRole('button', { name: '중복 확인' }).click()
  await expect(page.getByText('사용할 수 있어요.')).toBeVisible()
  await page.getByLabel('비밀번호', { exact: true }).fill('DemoPassword2026!')
  await page.getByLabel('비밀번호 확인').fill('DemoPassword2026!')
  await page.getByRole('button', { name: /^계정 만들기/ }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('link', { name: /계정 관리/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('봇 연습에서 카드 한 장을 순서대로 뒤집을 수 있다', async ({ page }) => {
  const errors = watchRuntimeErrors(page)
  await page.goto('/practice')
  await page.getByRole('button', { name: /천천히/ }).click()
  await page.getByRole('button', { name: /연습 시작/ }).click()
  await expect(page).toHaveURL(/\/game\?mode=bot&difficulty=easy/)
  const deck = page.getByRole('button', { name: /28 눌러서 뒤집기/ })
  await expect(deck).toBeEnabled()
  await deck.click()
  await expect(page.getByText(/이제 봇 차례예요|봇이 카드를 고르고 있어요/)).toBeVisible()
  expect(errors).toEqual([])
})

test('만료된 복구 링크와 존재하지 않는 경로가 복구 UI를 제공한다', async ({ page }) => {
  const errors = watchRuntimeErrors(page)
  await page.goto('/recover?type=recovery&error_code=otp_expired')
  await expect(page.getByRole('heading', { name: '재설정 링크를 사용할 수 없어요.' })).toBeVisible()
  await page.getByRole('button', { name: /다시 요청하기/ }).click()
  await expect(page).toHaveURL('/recover')
  await expect(page.getByRole('heading', { name: '계정에 다시 접속해요.' })).toBeVisible()
  await page.goto('/not-a-real-route')
  await expect(page.getByRole('heading', { name: '요청한 화면을 찾지 못했어요.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  expect(errors).toEqual([])
})
