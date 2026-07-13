import { BellRing, Check, Clock3, Search, UserPlus, UsersRound, X } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { enablePushNotifications } from '../lib/push'

const initialFriends = [
  { name: '제이미', tag: 'jamie#2048', online: true, color: '1' },
  { name: '민서', tag: 'minseo#7124', online: true, color: '2' },
  { name: '수현', tag: 'soohyun#0931', online: false, color: '3' },
]

export default function Friends() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'friends' | 'requests'>('friends')
  const [requestVisible, setRequestVisible] = useState(true)
  const [pushStatus, setPushStatus] = useState('')
  return (
    <div className="content-page friends-page">
      <PageHeader eyebrow="FRIENDS" title="함께하면 더 즐거워요." description="친구의 상태를 확인하고 게임에 초대하세요." />
      <div className="friends-toolbar">
        <div className="segmented-control"><button className={tab === 'friends' ? 'is-active' : ''} onClick={() => setTab('friends')}>친구 <span>3</span></button><button className={tab === 'requests' ? 'is-active' : ''} onClick={() => setTab('requests')}>요청 <span>{requestVisible ? 1 : 0}</span></button></div>
        <label className="search-field"><Search /><input placeholder="닉네임 또는 태그 검색" /><button aria-label="친구 추가"><UserPlus /></button></label>
        <button className="push-enable" onClick={() => user && void enablePushNotifications(user.id).then(() => setPushStatus('알림 켜짐')).catch(error => setPushStatus(error instanceof Error ? error.message : '알림 설정 실패'))}><BellRing /> {pushStatus || '초대 알림 켜기'}</button>
      </div>
      {tab === 'friends' ? (
        <section className="friends-list">
          <div className="section-title"><div><h2>내 친구</h2><p>2명 온라인</p></div></div>
          {initialFriends.map(friend => <article className="friend-row" key={friend.tag}><span className={`avatar avatar--${friend.color}`}>{friend.name[0]}<i className={friend.online ? 'is-online' : ''} /></span><span><strong>{friend.name}</strong><small>{friend.online ? '온라인' : '3시간 전 접속'} · {friend.tag}</small></span>{friend.online && <button className="invite-button"><BellRing /> 게임 초대</button>}</article>)}
        </section>
      ) : (
        <section className="friends-list request-list">
          <div className="section-title"><div><h2>받은 요청</h2><p>친구 요청을 확인하세요.</p></div></div>
          {requestVisible ? <article className="friend-row"><span className="avatar avatar--4">도</span><span><strong>도윤</strong><small>doyoon#5210 · 방금 전</small></span><div className="request-actions"><button onClick={() => setRequestVisible(false)}><Check /></button><button onClick={() => setRequestVisible(false)}><X /></button></div></article> : <div className="empty-state"><UsersRound /><strong>새로운 요청이 없어요.</strong><p>친구를 검색해 먼저 요청을 보내 보세요.</p></div>}
          <h3 className="subsection-title"><Clock3 /> 보낸 요청</h3>
          <article className="friend-row"><span className="avatar avatar--3">유</span><span><strong>유진</strong><small>yujin#3829 · 수락 대기 중</small></span><button className="text-button">취소</button></article>
        </section>
      )}
    </div>
  )
}
