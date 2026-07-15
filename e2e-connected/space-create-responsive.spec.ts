import { expect, test, type Page } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

async function login(page: Page) {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[0].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
}

test('스페이스 생성 모달은 주요 화면 폭에서 잘리지 않고 키보드 포커스를 가둔다', async ({ page }) => {
  await login(page)
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1024, height: 800 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto('/spaces')
    const trigger = page.getByRole('button', { name: '스페이스 생성', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '스페이스 생성' })
    await expect(dialog).toBeVisible()
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))).toBe(true)

    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)

    await page.getByLabel('스페이스 가입 코드').focus()
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  }
})
