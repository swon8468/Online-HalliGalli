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

test('푸시 토글은 처리 중 잠기고 브라우저 구독 해제 실패를 숨기지 않는다', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  await page.addInitScript(() => {
    let currentSubscription: PushSubscription | null = null
    const subscription = {
      endpoint: 'https://push.browser.test/subscription',
      toJSON: () => ({ endpoint: 'https://push.browser.test/subscription', keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(24) } }),
      unsubscribe: async () => false,
    } as unknown as PushSubscription
    const registration = {
      pushManager: {
        getSubscription: async () => currentSubscription,
        subscribe: async () => { currentSubscription = subscription; return subscription },
      },
    } as unknown as ServiceWorkerRegistration
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} })
    Object.defineProperty(window, 'Notification', { configurable: true, value: class Notification {
      static permission = 'granted'
      static requestPermission = async () => 'granted'
    } })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
    } })
  })
  await page.route('**/rest/v1/rpc/register_push_subscription', async route => {
    await new Promise(resolve => setTimeout(resolve, 350))
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })
  await page.route('**/rest/v1/push_subscriptions*', route => route.fulfill({ status: 204, body: '' }))

  await login(page)
  await page.goto('/friends')
  const enable = page.getByRole('button', { name: '초대 알림 켜기' })
  await expect(enable).toBeEnabled()
  await enable.click()
  const busy = page.getByRole('button', { name: '알림 변경 중' })
  await expect(busy).toBeDisabled()
  await expect(page.getByRole('button', { name: '초대 알림 끄기' })).toBeEnabled()

  await page.getByRole('button', { name: '초대 알림 끄기' }).click()
  await expect(page.getByRole('alert')).toContainText('브라우저의 푸시 구독을 해제하지 못했어요.')
  await expect(page.getByRole('button', { name: '초대 알림 끄기' })).toBeEnabled()
  expect(runtimeErrors).toEqual([])
})
