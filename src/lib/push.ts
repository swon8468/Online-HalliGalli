import { supabase } from './supabase'

function decodeBase64Url(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const bytes = atob((value + padding).replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(bytes, character => character.charCodeAt(0))
}

export async function enablePushNotifications(userId: string) {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey) throw new Error('VAPID 공개키가 설정되지 않았습니다.')
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('이 브라우저는 웹 푸시를 지원하지 않습니다.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다.')

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeBase64Url(publicKey) })
  const serialized = subscription.toJSON()
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) throw new Error('푸시 구독 정보를 만들지 못했습니다.')

  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: serialized.endpoint,
    p256dh: serialized.keys.p256dh,
    auth: serialized.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' })
  if (error) throw error
}
