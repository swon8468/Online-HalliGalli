import { Download, RefreshCw, Share, Wifi, WifiOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __halliGalliUpdateSW?: (reloadPage?: boolean) => Promise<void>
  }
}

export default function PwaCenter() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [restored, setRestored] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [offlineReady, setOfflineReady] = useState(false)
  const [iosHelp, setIosHelp] = useState(false)
  const [installStatus, setInstallStatus] = useState('')
  const [installDismissed, setInstallDismissed] = useState(() => localStorage.getItem('halli-galli:pwa-install-dismissed') === '1')
  const standalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)

  useEffect(() => {
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent) }
    const installed = () => { setInstallPrompt(null); setInstallDismissed(true) }
    const wentOffline = () => { setOnline(false); setRestored(false) }
    const cameOnline = () => { setOnline(true); setRestored(true); window.setTimeout(() => setRestored(false), 3500) }
    const needsRefresh = () => setUpdateReady(true)
    const cacheReady = () => { setOfflineReady(true); window.setTimeout(() => setOfflineReady(false), 3500) }
    window.addEventListener('beforeinstallprompt', beforeInstall)
    window.addEventListener('appinstalled', installed)
    window.addEventListener('offline', wentOffline)
    window.addEventListener('online', cameOnline)
    window.addEventListener('halli-galli:pwa-update', needsRefresh)
    window.addEventListener('halli-galli:pwa-offline-ready', cacheReady)
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', installed)
      window.removeEventListener('offline', wentOffline); window.removeEventListener('online', cameOnline)
      window.removeEventListener('halli-galli:pwa-update', needsRefresh); window.removeEventListener('halli-galli:pwa-offline-ready', cacheReady)
    }
  }, [])

  const install = async () => {
    if (installPrompt) {
      try {
        await installPrompt.prompt()
        const choice = await installPrompt.userChoice
        setInstallPrompt(null)
        setInstallStatus(choice.outcome === 'accepted' ? '앱 설치를 시작했어요.' : '설치를 취소했어요. 브라우저 메뉴에서 나중에 다시 설치할 수 있어요.')
      } catch {
        setInstallPrompt(null)
        setInstallStatus('설치 안내를 열지 못했어요. 브라우저 메뉴에서 앱 설치를 선택해 주세요.')
      }
    } else if (ios) setIosHelp(true)
  }
  const dismissInstall = () => { localStorage.setItem('halli-galli:pwa-install-dismissed', '1'); setInstallDismissed(true) }
  const applyUpdate = async () => {
    setUpdateError('')
    try {
      if (!window.__halliGalliUpdateSW) throw new Error('update unavailable')
      await window.__halliGalliUpdateSW(true)
    } catch {
      setUpdateError('업데이트를 적용하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.')
    }
  }

  return <>
    {!online && <aside className="pwa-network-banner is-offline" role="status"><WifiOff /><span><strong>오프라인 상태예요.</strong><small>저장된 화면은 볼 수 있지만 게임 입력은 연결 복구까지 중지됩니다.</small></span></aside>}
    {restored && <aside className="pwa-network-banner is-online" role="status"><Wifi /><span><strong>다시 연결됐어요.</strong><small>최신 게임 상태를 동기화하고 있습니다.</small></span></aside>}
    {offlineReady && <aside className="pwa-toast" role="status"><Download /> 오프라인 실행 준비가 완료됐어요.</aside>}
    {installStatus && <aside className="pwa-toast" role="status"><Download /> {installStatus}<button aria-label="설치 상태 닫기" onClick={() => setInstallStatus('')}><X /></button></aside>}
    {updateReady && <aside className="pwa-update-banner" role="status"><RefreshCw /><span><strong>새 버전이 준비됐어요.</strong><small>{updateError || '안전하게 새로고침해 업데이트합니다.'}</small></span><button onClick={() => void applyUpdate()}>{updateError ? '다시 시도' : '지금 업데이트'}</button></aside>}
    {!standalone && !installDismissed && (installPrompt || ios) && <aside className="pwa-install-banner"><Download /><span><strong>앱으로 설치하기</strong><small>{ios ? 'Safari 공유 메뉴에서 홈 화면에 추가할 수 있어요.' : '홈 화면에서 더 빠르게 실행하세요.'}</small></span><button onClick={() => void install()}>설치 안내</button><button aria-label="설치 안내 닫기" onClick={dismissInstall}><X /></button></aside>}
    {iosHelp && <section className="pwa-ios-overlay" role="dialog" aria-modal="true" aria-labelledby="ios-install-title"><div><button data-dialog-dismiss aria-label="iOS 설치 안내 닫기" onClick={() => setIosHelp(false)}><X /></button><Share /><h2 id="ios-install-title">iPhone·iPad에 설치하기</h2><ol><li>Safari 아래의 <strong>공유</strong> 버튼을 누르세요.</li><li><strong>홈 화면에 추가</strong>를 선택하세요.</li><li>오른쪽 위의 <strong>추가</strong>를 누르세요.</li></ol><button className="primary-button full-button" onClick={() => setIosHelp(false)}>확인했어요</button></div></section>}
  </>
}
