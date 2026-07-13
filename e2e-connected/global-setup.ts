import { accounts, connectedEnvironment, removeConnectedFixtures } from './fixture'

export default async function globalSetup() {
  await removeConnectedFixtures()
  const { admin, password } = await connectedEnvironment()
  for (const account of accounts) {
    const created = await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname }, app_metadata: { platform_role: account.role } })
    if (created.error || !created.data.user) throw created.error ?? new Error('연결형 E2E 계정을 만들지 못했습니다.')
    const profile = await admin.from('profiles').update({ nickname: account.nickname, platform_role: account.role, suspended_until: null, suspension_reason: null, deleted_at: null }).eq('id', created.data.user.id)
    if (profile.error) throw profile.error
  }
}
