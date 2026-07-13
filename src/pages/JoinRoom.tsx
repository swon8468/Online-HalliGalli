import { ArrowRight, Hash, LockKeyhole } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { inviteErrorMessage, respondGameInvite } from '../lib/invites'
import { getErrorMessage } from '../lib/errorMessage'
import { joinPrivateRoom } from '../lib/rooms'

function roomEntryMessage(reason: string | null, detail: string | null) {
  if (reason === 'kicked') return `이 방에서 강퇴됐어요.${detail ? ` 사유: ${detail}` : ''}`
  if (reason === 'closed') return '방장이 방을 닫았어요.'
  if (reason === 'removed') return '이 방에서 나갔거나 더 이상 참여할 수 없어요.'
  return ''
}

export default function JoinRoom() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialCode = (searchParams.get('code') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  const reason = searchParams.get('reason')
  const detail = searchParams.get('detail')
  const inviteId = searchParams.get('invite')
  const entryMessage = roomEntryMessage(reason, detail)
  const [code, setCode] = useState(initialCode)
  const [error, setError] = useState(entryMessage)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const lastCodeParam = useRef(initialCode)
  const lastEntryMessage = useRef(entryMessage)
  const handledInvites = useRef(new Set<string>())
  const inviteRequestVersion = useRef(0)
  const busy = submitBusy || inviteBusy

  useEffect(() => {
    if (initialCode === lastCodeParam.current) return
    lastCodeParam.current = initialCode
    setCode(initialCode)
  }, [initialCode])

  useEffect(() => {
    const previousMessage = lastEntryMessage.current
    if (entryMessage === previousMessage) return
    lastEntryMessage.current = entryMessage
    setError(current => entryMessage || (current === previousMessage ? '' : current))
  }, [entryMessage])

  useEffect(() => {
    const requestVersion = ++inviteRequestVersion.current
    if (!inviteId || handledInvites.current.has(inviteId)) {
      setInviteBusy(false)
      return
    }
    handledInvites.current.add(inviteId)
    setInviteBusy(true); setError('')
    void respondGameInvite(inviteId, true)
      .then(result => {
        if (requestVersion !== inviteRequestVersion.current) return
        if (result.roomId) navigate(`/room/${encodeURIComponent(result.roomId)}`, { replace: true })
        else setError('초대받은 방을 찾지 못했어요.')
      })
      .catch(cause => {
        if (requestVersion === inviteRequestVersion.current) setError(inviteErrorMessage(cause))
      })
      .finally(() => {
        if (requestVersion === inviteRequestVersion.current) setInviteBusy(false)
      })
  }, [inviteId, navigate])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^[A-Z]{3}[0-9]{3}$/.test(code)) return setError('영문 대문자 3개와 숫자 3개를 입력해 주세요.')
    setSubmitBusy(true); setError('')
    try { const joinedRoom = await joinPrivateRoom(code); navigate(`/room/${encodeURIComponent(joinedRoom.id)}`, { replace: true }) }
    catch (caught) {
      const message = getErrorMessage(caught)
      setError(message.includes('kicked_users_cannot_rejoin') || message.includes('kicked users cannot rejoin') ? '이 방에서 강퇴되어 다시 참여할 수 없어요.' : message.includes('room_full') || message.includes('room is full') ? '방이 가득 찼어요.' : message.includes('room_started') ? '이미 게임이 시작된 방이에요.' : message.includes('room_closed') ? '이미 닫힌 방이에요.' : message.includes('room_not_found') || message.includes('room not found') ? '방 코드를 확인해 주세요.' : message || '방에 참여하지 못했습니다.')
    }
    finally { setSubmitBusy(false) }
  }

  return <div className="content-page narrow-page play-flow-page"><PageHeader eyebrow="JOIN ROOM" title="초대받은 방으로 들어가세요." description="친구에게 받은 6자리 코드가 필요해요." /><form className="form-card join-form" onSubmit={submit}><label><span><Hash /> 방 코드</span><input className="code-input" value={code} onChange={event => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setError('') }} placeholder="ABC123" autoComplete="off" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full-button" type="submit" disabled={busy}>{busy ? '참여하는 중...' : <>방 참여하기 <ArrowRight /></>}</button><p className="privacy-note"><LockKeyhole /> 계정 닉네임으로 참여해요.</p></form></div>
}
