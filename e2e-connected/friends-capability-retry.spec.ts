import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

test('친구 초대 가능 여부 조회 실패를 숨기지 않고 재확인한다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  let blocked = true
  let requests = 0
  await page.route('**/rest/v1/rpc/get_game_invite_context', async route => {
    requests += 1
    await new Promise(resolve => setTimeout(resolve, 1_000))
    return blocked
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary invite context failure' }) })
      : route.continue()
  })

  await page.goto('/friends')
  await expect(page.getByRole('alert')).toContainText('게임 초대 가능 여부를 확인하지 못했어요.')
  expect(requests).toBe(1)

  blocked = false
  await page.getByRole('button', { name: '초대 상태 다시 확인' }).click()
  await expect(page.getByText('게임 초대 가능 여부를 확인하지 못했어요.')).toHaveCount(0)
  expect(requests).toBe(2)
})

test('푸시 상태 확인 실패를 알림 꺼짐으로 표시하지 않고 재확인한다', async ({ page }) => {
  const { password } = await connectedEnvironment()
  await page.addInitScript(() => {
    let failed = false
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} })
    Object.defineProperty(window, 'Notification', { configurable: true, value: class Notification { static permission = 'granted' } })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      getRegistration: async () => {
        const controlledWindow = window as Window & { failNextPushStatus?: boolean }
        if (controlledWindow.failNextPushStatus && !failed) {
          failed = true
          throw new Error('temporary service worker failure')
        }
        return undefined
      },
    } })
  })
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  await page.evaluate(() => { (window as Window & { failNextPushStatus?: boolean }).failNextPushStatus = true })
  await page.getByRole('link', { name: '친구', exact: true }).click()
  await expect(page).toHaveURL('/friends')
  const retry = page.getByRole('button', { name: '알림 상태 다시 확인' })
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(page.getByRole('button', { name: '초대 알림 켜기' })).toBeEnabled()
})
