import { Bell, ChevronLeft, Settings, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Fruit, type FruitKind } from '../components/Fruit'
import { loadGameView, revealGameCard, ringGameBell, subscribeToGame, type GamePlayerInfo, type GameSnapshot, type GameTableCard } from '../lib/rooms'

const playerDeck: { fruit: FruitKind; count: number }[] = [
  { fruit: 'strawberry', count: 3 }, { fruit: 'lime', count: 2 }, { fruit: 'banana', count: 4 },
  { fruit: 'plum', count: 1 }, { fruit: 'lime', count: 3 }, { fruit: 'banana', count: 1 },
]
const practiceBotDeck: { fruit: FruitKind; count: number }[] = [
  { fruit: 'strawberry', count: 2 }, { fruit: 'lime', count: 3 }, { fruit: 'banana', count: 1 },
  { fruit: 'plum', count: 4 }, { fruit: 'lime', count: 2 }, { fruit: 'banana', count: 4 },
]
const botDelay = { easy: 2400, normal: 1400, hard: 700 } as const

const emptyState: GameSnapshot = {
  phase: 'playing', round: 1, version: 0, currentTurn: '', table: [],
  fruitTotals: { strawberry: 0, banana: 0, lime: 0, plum: 0 }, bellActive: false, winnerId: null,
}

function gameErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : ''
  if (message.includes('not your turn')) return '아직 내 차례가 아니에요.'
  if (message.includes('already_rung')) return '이번 카드에서는 이미 종이 울렸어요.'
  if (message.includes('no cards')) return '뒤집을 카드가 없어요.'
  return message || '게임 상태를 처리하지 못했습니다.'
}

function isFive(cards: Array<GameTableCard | null>) {
  const totals: Record<FruitKind, number> = { strawberry: 0, banana: 0, lime: 0, plum: 0 }
  cards.forEach(card => { if (card) totals[card.fruit] += card.count })
  return Object.values(totals).some(total => total === 5)
}

function FaceCard({ card, owner }: { card?: GameTableCard | null; owner: string }) {
  return card
    ? <div className="arena-face-card"><Fruit kind={card.fruit} count={card.count} size="large" /><small>{owner}의 공개 카드</small></div>
    : <div className="arena-face-card is-empty"><span>공개 카드</span><small>{owner}</small></div>
}

export default function Game() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const isBotMode = searchParams.get('mode') === 'bot'
  const difficulty = (searchParams.get('difficulty') ?? 'normal') as keyof typeof botDelay
  const gameId = searchParams.get('game')
  const [sound, setSound] = useState(true)
  const [message, setMessage] = useState('게임 상태를 불러오는 중이에요.')
  const [players, setPlayers] = useState<GamePlayerInfo[]>([])
  const [state, setState] = useState<GameSnapshot>(emptyState)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)

  const [practiceTurn, setPracticeTurn] = useState<'player' | 'bot' | 'bot-delay'>('player')
  const [playerIndex, setPlayerIndex] = useState(0)
  const [botIndex, setBotIndex] = useState(0)
  const [playerCount, setPlayerCount] = useState(28)
  const [botCount, setBotCount] = useState(28)
  const [playerFace, setPlayerFace] = useState<GameTableCard | null>(null)
  const [botFace, setBotFace] = useState<GameTableCard | null>(null)
  const [tablePot, setTablePot] = useState(0)
  const [practiceBellLocked, setPracticeBellLocked] = useState(false)

  const refresh = useCallback(async () => {
    if (!gameId || isBotMode) return
    try {
      const view = await loadGameView(gameId)
      setPlayers(view.players)
      setState(view.state)
      if (view.state.phase === 'finished') {
        const winner = view.players.find(player => player.userId === view.state.winnerId)
        setMessage(winner?.userId === user?.id ? '승리했어요! 모든 카드를 모았습니다.' : `${winner?.nickname ?? '상대방'}님이 승리했어요.`)
      } else if (view.state.lastResult?.type === 'ring') {
        const actor = view.players.find(player => player.userId === view.state.lastResult?.userId)
        const mine = actor?.userId === user?.id
        setSuccess(Boolean(view.state.lastResult.correct && mine))
        setMessage(view.state.lastResult.correct
          ? `${mine ? '정답이에요!' : `${actor?.nickname ?? '상대방'}님이 정답을 맞혔어요.`} 공개된 카드를 가져갑니다.`
          : `${mine ? '오답이에요.' : `${actor?.nickname ?? '상대방'}님이 잘못 울렸어요.`} 다른 플레이어에게 한 장씩 줍니다.`)
      } else if (view.state.currentTurn === user?.id) setMessage('내 차례예요. 아래 카드 더미를 누르세요.')
      else setMessage('상대방이 카드를 뒤집을 차례예요.')
    } catch (caught) { setMessage(gameErrorMessage(caught)) }
  }, [gameId, isBotMode, user?.id])

  useEffect(() => {
    if (isBotMode) { setMessage('내 차례예요. 아래 카드 더미를 누르세요.'); return }
    if (!gameId) { setMessage('게임 정보가 없습니다. 방에서 다시 시작해 주세요.'); return }
    void refresh()
    return subscribeToGame(gameId, () => void refresh())
  }, [gameId, isBotMode, refresh])

  useEffect(() => {
    if (!isBotMode || practiceTurn !== 'bot' || botCount <= 0) return
    if (isFive([playerFace, botFace])) return
    setMessage('봇이 카드를 고르고 있어요...')
    const timer = window.setTimeout(() => {
      const next = practiceBotDeck[botIndex % practiceBotDeck.length]
      setBotFace({ userId: 'bot', ...next })
      setBotIndex(index => index + 1)
      setBotCount(count => Math.max(0, count - 1))
      setTablePot(count => count + 1)
      setPracticeBellLocked(false)
      setPracticeTurn('player')
      setMessage('봇이 카드를 뒤집었어요. 다섯인지 확인하세요!')
    }, Math.min(900, botDelay[difficulty]))
    return () => window.clearTimeout(timer)
  }, [botCount, botFace, botIndex, difficulty, isBotMode, playerFace, practiceTurn])

  useEffect(() => {
    if (!isBotMode || practiceTurn !== 'bot-delay') return
    const timer = window.setTimeout(() => setPracticeTurn('bot'), 1300)
    return () => window.clearTimeout(timer)
  }, [isBotMode, practiceTurn])

  useEffect(() => {
    if (!isBotMode || practiceBellLocked || !isFive([playerFace, botFace])) return
    const timer = window.setTimeout(() => {
      setBotCount(count => count + tablePot)
      setPlayerFace(null); setBotFace(null); setTablePot(0)
      setPracticeTurn('bot-delay'); setSuccess(false)
      setMessage('봇이 먼저 종을 울렸어요. 공개 카드를 봇이 가져갑니다.')
    }, botDelay[difficulty])
    return () => window.clearTimeout(timer)
  }, [botFace, difficulty, isBotMode, playerFace, practiceBellLocked, tablePot])

  const me = players.find(player => player.userId === user?.id)
  const myTurn = isBotMode ? practiceTurn === 'player' : state.currentTurn === user?.id
  const myCount = isBotMode ? playerCount : me?.cardCount ?? 0
  const winner = players.find(player => player.userId === state.winnerId)
  const bellLocked = isBotMode ? practiceBellLocked : state.lastResult?.type === 'ring'
  const opponents = isBotMode ? [] : players.filter(player => player.userId !== user?.id)
  const onlineMyFace = state.table.find(card => card.userId === user?.id)

  const reveal = async () => {
    setSuccess(false)
    if (isBotMode) {
      if (practiceTurn !== 'player' || playerCount <= 0) return
      const next = playerDeck[playerIndex % playerDeck.length]
      setPlayerFace({ userId: 'player', ...next })
      setPlayerIndex(index => index + 1)
      setPlayerCount(count => Math.max(0, count - 1))
      setTablePot(count => count + 1)
      setPracticeBellLocked(false)
      setPracticeTurn('bot')
      setMessage('카드를 뒤집었어요. 이제 봇 차례예요.')
      return
    }
    if (!gameId) return
    setBusy(true)
    try { setState(await revealGameCard(gameId)); await refresh() }
    catch (caught) { setMessage(gameErrorMessage(caught)) }
    finally { setBusy(false) }
  }

  const ring = async () => {
    setSuccess(false)
    if (isBotMode) {
      if (practiceBellLocked || (!playerFace && !botFace)) return
      const correct = isFive([playerFace, botFace])
      setSuccess(correct)
      if (correct) {
        setPlayerCount(count => count + tablePot)
        setPlayerFace(null); setBotFace(null); setTablePot(0)
        setPracticeTurn('player')
        setMessage('정답이에요! 공개된 카드를 모두 가져왔어요.')
      } else {
        setPlayerCount(count => Math.max(0, count - 1))
        setBotCount(count => count + 1)
        setPracticeBellLocked(true)
        setMessage('아직 다섯이 아니에요. 봇에게 카드 한 장을 줬어요.')
      }
      return
    }
    if (!gameId) return
    setBusy(true)
    try {
      const result = await ringGameBell(gameId)
      if (!result.accepted) setMessage(result.reason === 'already_rung' ? '이번 카드에서는 이미 종이 울렸어요.' : '종을 울릴 수 없어요.')
      await refresh()
    } catch (caught) { setMessage(gameErrorMessage(caught)) }
    finally { setBusy(false) }
  }

  return (
    <div className="game-page game-page--arena">
      <header className="game-topbar">
        <button onClick={() => navigate('/')} aria-label="게임 나가기"><ChevronLeft /></button>
        <div><span>{state.phase === 'finished' ? 'GAME OVER' : `ROUND ${isBotMode ? playerIndex + botIndex + 1 : state.round}`}</span><strong>{isBotMode ? 'BOT PRACTICE' : 'LIVE GAME'}</strong></div>
        <div><button onClick={() => setSound(value => !value)} aria-label="소리 켜기 또는 끄기">{sound ? <Volume2 /> : <VolumeX />}</button><button aria-label="게임 설정"><Settings /></button></div>
      </header>

      <main className="halli-arena">
        <section className="arena-opponents" aria-label="상대 플레이어">
          {isBotMode ? <article className={`arena-station opponent-station ${practiceTurn !== 'player' ? 'is-turn' : ''}`}><div className="station-profile"><span className="avatar avatar--2">BOT<i className="is-online" /></span><span><strong>연습 봇</strong><small>{difficulty === 'easy' ? '천천히' : difficulty === 'hard' ? '빠르게' : '보통'}</small></span><b>{botCount}장</b></div><div className="station-play"><div className="mini-deck"><strong>{botCount}</strong><small>봇 카드</small></div><FaceCard card={botFace} owner="봇" /></div></article> : opponents.map((player, index) => <article className={`arena-station opponent-station ${player.isCurrentTurn ? 'is-turn' : ''}`} key={player.userId}><div className="station-profile"><span className={`avatar avatar--${index + 1}`}>{player.nickname[0]}<i className="is-online" /></span><span><strong>{player.nickname}</strong><small>{player.isCurrentTurn ? '카드 뒤집는 중' : '대기 중'}</small></span><b>{player.cardCount}장</b></div><div className="station-play"><div className="mini-deck"><strong>{player.cardCount}</strong><small>보유 카드</small></div><FaceCard card={state.table.find(card => card.userId === player.userId)} owner={player.nickname} /></div></article>)}
        </section>

        <section className="arena-center">
          <div className={`turn-pill ${myTurn ? 'is-mine' : ''}`}>{myTurn ? '내 차례' : '상대 차례'}</div>
          <button className="arena-bell" onClick={() => void ring()} disabled={busy || state.phase === 'finished' || bellLocked || (isBotMode ? !playerFace && !botFace : state.table.length === 0)} aria-label="종 울리기"><span /><Bell /><strong>{bellLocked ? '다음 카드까지 대기' : '종 울리기'}</strong></button>
          <div className={`arena-message ${success ? 'is-success' : ''}`} aria-live="polite">{state.phase === 'finished' && winner ? `${winner.nickname} 승리 · ` : ''}{message}</div>
        </section>

        <section className={`arena-station player-station ${myTurn ? 'is-turn' : ''}`} aria-label="내 플레이 영역">
          <div className="station-profile"><span className="avatar avatar--4">나<i className="is-online" /></span><span><strong>{isBotMode ? '나' : me?.nickname ?? '플레이어'}</strong><small>{myTurn ? '카드를 뒤집으세요' : '상대 차례를 기다리는 중'}</small></span><b>{myCount}장</b></div>
          <div className="station-play player-play"><FaceCard card={isBotMode ? playerFace : onlineMyFace} owner="나" /><button className="player-deck" onClick={() => void reveal()} disabled={!myTurn || busy || state.phase === 'finished' || myCount === 0}><i /><i /><strong>{myCount}</strong><small>{myTurn ? '눌러서 뒤집기' : '상대 차례'}</small></button></div>
        </section>
      </main>
    </div>
  )
}
