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
  await expect(page.getByRole('region', { name: '내 플레이 영역' })).toContainText('27장')
  await expect(page.locator('.arena-message')).toContainText(/이제 봇 차례예요|봇이 카드를 고르고 있어요|같은 과일의 합이 5예요/)
  await expect.poll(() => page.locator('[data-card-id]').count()).toBeGreaterThanOrEqual(1)
  expect(errors).toEqual([])
})

test('봇 오답은 즉시 안내되고 벌칙 카드가 플레이어에게 이동한다', async ({ page }) => {
  const errors = watchRuntimeErrors(page)
  await page.addInitScript(() => { Math.random = () => 0.5 })
  await page.goto('/game?mode=bot&difficulty=easy&_testBotRing=wrong')
  await page.getByRole('button', { name: '28 눌러서 뒤집기' }).click()

  await expect(page.getByText('봇이 종을 잘못 눌렀어요! 벌칙 카드 1장을 받는 중이에요.')).toBeVisible({ timeout: 6_000 })
  await expect(page.locator('.card-motion-layer.penalty-opponent')).toBeVisible()
  await expect(page.getByText('봇이 종을 잘못 눌렀어요! 벌칙 카드 1장을 받았어요.')).toBeVisible({ timeout: 3_000 })
  await expect(page.getByRole('region', { name: '상대 플레이어' })).toContainText('27장')
  await expect(page.locator('.arena-message')).toHaveClass(/is-error/)
  await expect(page.getByRole('button', { name: '28 눌러서 뒤집기' })).toBeEnabled()
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

test('320·360·390px 모바일에서 게임은 페이지 스크롤 없이 핵심 조작을 표시한다', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'viewport matrix는 한 브라우저 엔진에서 한 번만 검증합니다.')
  const errors = watchRuntimeErrors(page)
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/game?mode=bot&difficulty=normal')
    await expect(page.getByRole('button', { name: /눌러서 뒤집기/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '종 울리기' })).toBeVisible()
    const layout = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight - window.innerHeight,
    }))
    expect(layout.horizontalOverflow, `${viewport.width}px 가로 오버플로`).toBe(0)
    expect(layout.verticalOverflow, `${viewport.width}px 세로 오버플로`).toBeLessThanOrEqual(0)
  }
  expect(errors).toEqual([])
})

test('좁은 모바일에서도 인증 입력 텍스트는 가운데 정렬된다', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'viewport matrix는 한 브라우저 엔진에서 한 번만 검증합니다.')
  const errors = watchRuntimeErrors(page)
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/auth')
  const alignments = await page.locator('input').evaluateAll(inputs => inputs.map(input => getComputedStyle(input).textAlign))
  expect(alignments.length).toBeGreaterThan(0)
  expect(alignments.every(alignment => alignment === 'center')).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  expect(errors).toEqual([])
})

test('PWA 설치 취소·오프라인 복구·업데이트 안내가 다시 사용할 수 있는 상태로 끝난다', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'PWA 합성 이벤트는 한 브라우저 엔진에서 한 번만 검증합니다.')
  const errors = watchRuntimeErrors(page)
  await page.goto('/')

  await page.evaluate(() => {
    const target = window as Window & { __pwaPromptCount?: number }
    target.__pwaPromptCount = 0
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'dismissed' }>
    }
    event.prompt = async () => { target.__pwaPromptCount = (target.__pwaPromptCount ?? 0) + 1 }
    event.userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(event)
  })
  await page.getByRole('button', { name: '설치 안내', exact: true }).click()
  await expect(page.getByText('설치를 취소했어요. 브라우저 메뉴에서 나중에 다시 설치할 수 있어요.')).toBeVisible()
  await expect(page.getByRole('button', { name: '설치 안내', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { __pwaPromptCount?: number }).__pwaPromptCount)).toBe(1)

  await page.getByRole('button', { name: '설치 상태 닫기' }).click()
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'accepted' }>
    }
    event.prompt = async () => { throw new DOMException('prompt already used', 'InvalidStateError') }
    event.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(event)
  })
  await page.getByRole('button', { name: '설치 안내', exact: true }).click()
  await expect(page.getByText('설치 안내를 열지 못했어요. 브라우저 메뉴에서 앱 설치를 선택해 주세요.')).toBeVisible()
  await expect(page.getByRole('button', { name: '설치 안내', exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 320, height: 568 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)

  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByText('오프라인 상태예요.')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('다시 연결됐어요.')).toBeVisible()

  await page.evaluate(() => {
    window.__halliGalliUpdateSW = async reload => { sessionStorage.setItem('e2e:update-reload', String(reload)) }
    window.dispatchEvent(new Event('halli-galli:pwa-update'))
  })
  await page.getByRole('button', { name: '지금 업데이트' }).click()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('e2e:update-reload'))).toBe('true')
  expect(errors).toEqual([])
})
