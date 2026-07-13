import { expect, test } from '@playwright/test'

async function openSignup(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.getByRole('button', { name: '가입하기', exact: true }).click()
}

test('이전 이메일의 늦은 중복 확인 결과를 새 이메일에 적용하지 않는다', async ({ page }) => {
  let firstStarted = false
  let releaseFirst: (() => void) | undefined
  const pending = new Promise<void>(resolve => { releaseFirst = resolve })
  await page.route('**/functions/v1/check-identifier', async route => {
    firstStarted = true
    await pending
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) })
  })

  await openSignup(page)
  const email = page.getByLabel('이메일')
  await email.fill('first-check@swonport.kr')
  await page.getByRole('button', { name: '중복 확인' }).click()
  await expect.poll(() => firstStarted).toBe(true)
  await email.fill('changed-check@swonport.kr')
  releaseFirst?.()

  await page.waitForTimeout(200)
  await expect(page.getByText('사용할 수 있어요.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '중복 확인' })).toBeEnabled()
})

test('중복 확인 네트워크 실패 후 다시 시도할 수 있다', async ({ page }) => {
  await page.route('**/functions/v1/check-identifier', route => route.abort('failed'))
  await openSignup(page)
  await page.getByLabel('이메일').fill('network-failure@swonport.kr')
  await page.getByRole('button', { name: '중복 확인' }).click()

  await expect(page.getByText('중복 확인에 실패했어요. 잠시 후 다시 시도해 주세요.')).toBeVisible()
  await expect(page.getByRole('button', { name: '중복 확인' })).toBeEnabled()
})
