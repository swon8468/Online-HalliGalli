import { Bell, ChevronLeft, Settings, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Fruit, type FruitKind } from '../components/Fruit'
import { loadGameView, revealGameCard, ringGameBell, subscribeToGame, type GamePlayerInfo, type GameSnapshot, type GameTableCard } from '../lib/rooms'

const botDeck: { kind: FruitKind; count: number }[] = [
  { kind: 'strawberry', count: 3 }, { kind: 'lime', count: 2 }, { kind: 'banana', count: 4 },
  { kind: 'plum', count: 1 }, { kind: 'lime', count: 3 }, { kind: 'banana', count: 1 },
]

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

export default function Game() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const isBotMode = searchParams.get('mode') === 'bot'
  const difficulty = searchParams.get('difficulty') ?? 'normal'
  const gameId = searchParams.get('game')
  const [cardIndex, setCardIndex] = useState(0)
  const [sound, setSound] = useState(true)
  const [message, setMessage] = useState('게임 상태를 불러오는 중이에요.')
  const [botScore, setBotScore] = useState(14)
  const [players, setPlayers] = useState<GamePlayerInfo[]>([])
  const [state, setState] = useState<GameSnapshot>(emptyState)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)

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
      } else if (view.state.currentTurn === user?.id) setMessage('내 차례예요. 카드를 뒤집으세요.')
      else setMessage('상대방이 카드를 뒤집을 차례예요.')
    } catch (caught) { setMessage(gameErrorMessage(caught)) }
  }, [gameId, isBotMode, user?.id])

  useEffect(() => {
    if (isBotMode) { setMessage('내 차례예요. 카드를 뒤집으세요.'); return }
    if (!gameId) { setMessage('게임 정보가 없습니다. 방에서 다시 시작해 주세요.'); return }
    void refresh()
    return subscribeToGame(gameId, () => void refresh())
  }, [gameId, isBotMode, refresh])

  const me = players.find(player => player.userId === user?.id)
  const myTurn = isBotMode || state.currentTurn === user?.id
  const score = isBotMode ? botScore : me?.cardCount ?? 0
  const winner = players.find(player => player.userId === state.winnerId)
  const bellLocked = !isBotMode && state.lastResult?.type === 'ring'
  const botCard = botDeck[cardIndex % botDeck.length]
  const onlineCards = state.table
  const cards: GameTableCard[] = isBotMode
    ? [{ userId: 'left', fruit: 'strawberry', count: 2 }, { userId: 'me', fruit: botCard.kind, count: botCard.count }, { userId: 'right', fruit: 'banana', count: 4 }]
    : onlineCards
  const playerNames = useMemo(() => Object.fromEntries(players.map(player => [player.userId, player.nickname])), [players])

  const reveal = async () => {
    setSuccess(false)
    if (isBotMode) { setCardIndex(index => index + 1); setMessage('같은 과일의 합을 확인하세요.'); return }
    if (!gameId) return
    setBusy(true)
    try {
      const snapshot = await revealGameCard(gameId)
      setState(snapshot)
      setMessage('카드를 공개했어요. 같은 과일의 합을 확인하세요.')
      await refresh()
    } catch (caught) { setMessage(gameErrorMessage(caught)) }
    finally { setBusy(false) }
  }

  const ring = async () => {
    setSuccess(false)
    if (isBotMode) {
      const correct = botCard.kind === 'strawberry' && botCard.count === 3
      setMessage(correct ? '정답이에요. 공개된 카드를 가져왔어요.' : '아직 다섯이 아니에요. 카드 한 장을 잃었어요.')
      setSuccess(correct)
      setBotScore(value => Math.max(0, value + (correct ? 4 : -1)))
      return
    }
    if (!gameId) return
    setBusy(true)
    try {
      const result = await ringGameBell(gameId)
      if (!result.accepted) setMessage(result.reason === 'already_rung' ? '이번 카드에서는 이미 종이 울렸어요.' : '종을 울릴 수 없어요.')
      else {
        setSuccess(Boolean(result.correct))
        setMessage(result.correct ? '정답이에요! 공개된 카드를 모두 가져왔어요.' : '오답이에요. 다른 플레이어에게 카드를 한 장씩 줬어요.')
      }
      await refresh()
    } catch (caught) { setMessage(gameErrorMessage(caught)) }
    finally { setBusy(false) }
  }

  return (
    <div className="game-page">
      <header className="game-topbar">
        <button onClick={() => navigate('/')} aria-label="게임 나가기"><ChevronLeft /></button>
        <div><span>{state.phase === 'finished' ? 'GAME OVER' : `ROUND ${isBotMode ? cardIndex + 1 : state.round}`}</span><strong>{isBotMode ? 'BOT PRACTICE' : 'LIVE GAME'}</strong></div>
        <div><button onClick={() => setSound(value => !value)} aria-label="소리 켜기 또는 끄기">{sound ? <Volume2 /> : <VolumeX />}</button><button aria-label="게임 설정"><Settings /></button></div>
      </header>

      <div className="opponents">
        {isBotMode ? <div className="opponent is-turn bot-opponent"><span className="avatar avatar--2">BOT<i className="is-online" /></span><strong>연습 봇</strong><small>{difficulty === 'easy' ? '천천히' : difficulty === 'hard' ? '빠르게' : '보통'} · 카드 28장</small></div> : players.filter(player => player.userId !== user?.id).map((player, index) => <div className={`opponent ${player.isCurrentTurn ? 'is-turn' : ''}`} key={player.userId}><span className={`avatar avatar--${index + 1}`}>{player.nickname[0]}<i className="is-online" /></span><strong>{player.nickname}</strong><small>카드 {player.cardCount}장</small></div>)}
      </div>

      <section className="game-table game-table--live">
        <div className="table-card-grid">
          {cards.map((card, index) => <div className="table-card" key={`${card.userId}-${index}`}><Fruit kind={card.fruit} count={card.count} size="large" /><small>{isBotMode ? (index === 1 ? '나' : '상대') : playerNames[card.userId]}</small></div>)}
          {!cards.length && <div className="empty-table">첫 카드를 기다리고 있어요.</div>}
        </div>
        <button className="reveal-button" onClick={() => void reveal()} disabled={!myTurn || busy || state.phase === 'finished' || score === 0}>{busy ? '처리 중...' : myTurn ? '카드 뒤집기' : '상대 차례'}</button>
        <div className={`deck-stack ${myTurn ? 'is-turn' : ''}`}><i /><strong>{score}</strong><small>내 카드</small></div>
      </section>

      <div className={`game-message ${success ? 'is-success' : ''}`} aria-live="polite">{state.phase === 'finished' && winner ? `${winner.nickname} 승리 · ` : ''}{message}</div>
      <button className="bell-button" onClick={() => void ring()} disabled={busy || state.phase === 'finished' || (!isBotMode && (state.table.length === 0 || bellLocked))}><span /><Bell /><strong>{bellLocked ? '다음 카드 대기' : '종 울리기'}</strong></button>
      <p className="game-hint">같은 과일이 정확히 5개일 때 누르세요. 오답이면 모두에게 한 장씩 줍니다.</p>
    </div>
  )
}
