import { expect, test } from '@playwright/test'
import { accounts, connectedEnvironment } from './fixture'

async function login(page: import('@playwright/test').Page) {
  const { password } = await connectedEnvironment()
  await page.goto('/auth')
  await page.getByLabel('이메일').fill(accounts[1].email)
  await page.getByLabel('비밀번호').fill(password)
  await page.locator('form').getByRole('button', { name: '로그인', exact: true }).last().click()
  await expect(page).toHaveURL('/')
}

test('같은 참여 화면에서 변경된 코드와 퇴장 사유를 즉시 반영한다', async ({ page }) => {
  await login(page)
  await page.goto('/join?code=ABC123')
  const code = page.getByLabel('방 코드')
  await expect(code).toHaveValue('ABC123')
  await code.fill('AB')
  await page.getByRole('button', { name: '방 참여하기' }).click()
  await expect(code).toHaveAttribute('aria-invalid', 'true')
  await expect(code).toHaveAttribute('aria-describedby', 'join-room-error')

  await page.evaluate(() => {
    history.pushState({}, '', '/join?code=XYZ999&reason=kicked&detail=%EC%8B%A0%EA%B3%A0')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  await expect(code).toHaveValue('XYZ999')
  await expect(page.getByRole('alert')).toContainText('이 방에서 강퇴됐어요. 사유: 신고')
})

test('늦은 이전 초대 응답이 최신 초대 오류를 덮어쓰거나 이동시키지 않는다', async ({ page }) => {
  await login(page)
  const firstInvite = '00000000-0000-4000-8000-000000000101'
  const secondInvite = '00000000-0000-4000-8000-000000000202'
  let firstStarted = false

  await page.route('**/rest/v1/rpc/respond_game_invite', async route => {
    const invite = (route.request().postDataJSON() as { p_invite_id?: string }).p_invite_id
    if (invite === firstInvite) {
      firstStarted = true
      await new Promise(resolve => setTimeout(resolve, 1_200))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'accepted', roomId: '00000000-0000-4000-8000-000000000303' }),
      })
    }
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'invite_expired' }),
    })
  })

  await page.goto(`/join?invite=${firstInvite}`)
  await expect.poll(() => firstStarted).toBe(true)
  await page.evaluate(invite => {
    history.pushState({}, '', `/join?invite=${invite}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, secondInvite)

  await expect(page.getByRole('alert')).toContainText('초대가 만료됐어요.')
  await page.waitForTimeout(1_300)
  await expect(page).toHaveURL(new RegExp(`/join\\?invite=${secondInvite}$`))
  await expect(page.getByRole('alert')).toContainText('초대가 만료됐어요.')
  await expect(page.getByRole('button', { name: '방 참여하기' })).toBeEnabled()
})
