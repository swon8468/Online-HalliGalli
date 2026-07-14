import { supabase } from './supabase'

function decodeBase64Url(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const bytes = atob((value + padding).replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(bytes, character => character.charCodeAt(0))
}

export async function enablePushNotifications() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey) throw new Error('VAPID 공개키가 설정되지 않았습니다.')
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('이 브라우저는 웹 푸시를 지원하지 않습니다.')

  if (Notification.permission === 'denied') throw new Error('브라우저 설정에서 Halli Galli 알림 권한을 다시 허용해 주세요.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다.')

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeBase64Url(publicKey) })
  const serialized = subscription.toJSON()
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) throw new Error('푸시 구독 정보를 만들지 못했습니다.')

  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: serialized.endpoint,
    p_p256dh: serialized.keys.p256dh,
    p_auth: serialized.keys.auth,
    p_user_agent: navigator.userAgent,
  })
  if (error) throw error
  return true
}

export async function getPushNotificationStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported' as const
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return 'disabled' as const
  const subscription = await registration.pushManager.getSubscription()
  return subscription && Notification.permission === 'granted' ? 'enabled' as const : 'disabled' as const
}

export async function disablePushNotifications() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  if (error) throw error
  if (!await subscription.unsubscribe()) throw new Error('브라우저의 푸시 구독을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.')
}
