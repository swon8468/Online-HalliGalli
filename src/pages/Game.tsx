import { Bell, ChevronLeft, Home, LogOut, RotateCcw, Settings, Trophy, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Fruit } from '../components/Fruit'
import { createPracticeGame, decideBotBell, getPracticeTableCards, getPracticeTopCards, practiceBotRingMessage, practiceBotWrongPendingMessage, practiceDifficulty, practiceIsExactFive, revealPracticeCard, ringPracticeBell, type PracticeActor, type PracticeCard, type PracticeDifficulty, type PracticeGameState } from '../game/practiceEngine'
import { loadGameSettings, playGameSound, saveGameSettings, vibrateGame, type GameSettings } from '../game/settings'
import { useSessionHeartbeat } from '../hooks/useSessionHeartbeat'
import { getErrorMessage } from '../lib/errorMessage'
import { abandonGame, findMyActiveSession, loadGameView, requestGameRematch, returnFinishedGameToRoom, revealGameCard, ringGameBell, subscribeToGame, type GameCardTheme, type GamePlayerInfo, type GameSnapshot, type GameTableCard } from '../lib/rooms'

const emptyState: GameSnapshot = {
  phase: 'playing', round: 1, version: 0, currentTurn: '', table: [],
  fruitTotals: { strawberry: 0, banana: 0, lime: 0, plum: 0 }, bellActive: false, winnerId: null,
}

function gameErrorMessage(caught: unknown) {
  const message = getErrorMessage(caught)
  if (message.includes('not your turn')) return '아직 내 차례가 아니에요.'
  if (message.includes('already_rung')) return '이번 카드에서는 이미 종이 울렸어요.'
  if (message.includes('no cards')) return '뒤집을 카드가 없어요.'
  if (message.includes('game is not active')) return '이미 종료된 게임이에요.'
  if (message.includes('player eliminated')) return '카드를 모두 사용해 이번 게임에서 탈락했어요.'
  if (message.includes('player abandoned')) return '이미 게임에서 나간 플레이어예요.'
  if (message.includes('abandoned players cannot rematch')) return '게임에서 나간 플레이어는 재경기를 요청할 수 없어요.'
  if (message.includes('not enough players for rematch')) return '재경기에는 두 명 이상이 필요해요.'
  if (message.includes('game_action_rate_limited')) return '입력이 너무 빨라요. 잠시 후 다시 시도해 주세요.'
  return message || '게임 상태를 처리하지 못했습니다.'
}

function toTableCard(owner: PracticeActor, card: PracticeCard | null): GameTableCard | null {
  return card ? { cardId: card.id, userId: owner, fruit: card.fruit, count: card.count } : null
}

function FaceCard({ card, owner, theme, isMine = false, eliminated = false }: { card?: GameTableCard | null; owner: string; theme?: GameCardTheme | null; isMine?: boolean; eliminated?: boolean }) {
  const className = `arena-face-card ${card ? '' : 'is-empty'} ${isMine ? 'is-mine' : ''} ${eliminated ? 'is-eliminated' : ''}`.trim()
  const design = card ? theme?.designs.find(item => item.fruit === card.fruit && item.count === card.count) : null
  const [assetFailed, setAssetFailed] = useState(false)
  useEffect(() => { setAssetFailed(false) }, [design?.assetUrl])
  return card
    ? <div className={className} data-card-id={card.cardId} style={{ background: design?.style.background ?? '#ffffff', color: design?.style.accent ?? '#111111' }}>{design?.assetUrl && !assetFailed ? <img className="custom-card-face-image" src={design.assetUrl} alt={`${design.label || card.fruit} ${card.count}개`} onError={() => setAssetFailed(true)} /> : <Fruit kind={card.fruit} count={card.count} size="large" />}<small>{owner}의 공개 카드</small></div>
    : <div className={className}><span>{eliminated ? '탈락' : '공개 카드'}</span><small>{owner}</small></div>
}

type CardMotion = {
  id: number
  kind: 'play-player' | 'play-opponent' | 'collect-player' | 'collect-opponent' | 'penalty-player' | 'penalty-opponent'
  cards?: GameTableCard[]
  count?: number
}

type GameImpact = { id: number; type: 'success' | 'error'; title: string; detail: string }

export default function Game() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const isBotMode = searchParams.get('mode') === 'bot'
  const requestedDifficulty = searchParams.get('difficulty')
  const difficulty: PracticeDifficulty = requestedDifficulty === 'easy' || requestedDifficulty === 'hard' ? requestedDifficulty : 'normal'
  const testBotRing = import.meta.env.MODE === 'e2e' ? searchParams.get('_testBotRing') : null
  const gameId = searchParams.get('game')
  const [settings, setSettings] = useState<GameSettings>(() => loadGameSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [message, setMessage] = useState('게임 상태를 불러오는 중이에요.')
  const [players, setPlayers] = useState<GamePlayerInfo[]>([])
  const [state, setState] = useState<GameSnapshot>(emptyState)
  const [theme, setTheme] = useState<GameCardTheme | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null)
  const [impact, setImpact] = useState<GameImpact | null>(null)
  const [motion, setMotion] = useState<CardMotion | null>(null)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [rematchBusy, setRematchBusy] = useState(false)
  const [roomBusy, setRoomBusy] = useState(false)
  const tableRef = useRef<GameTableCard[]>([])
  const versionRef = useRef<number | null>(null)
  const [practice, setPractice] = useState(() => createPracticeGame())
  const [practicePauseVersion, setPracticePauseVersion] = useState<number | null>(null)
  const practiceRef = useRef(practice)
  const botActionVersionRef = useRef<number | null>(null)
  const forcedBotRingUsedRef = useRef(false)
  const practiceBusyRef = useRef(false)
  const resultFxRef = useRef('')
  const impactTimerRef = useRef<number | null>(null)
  practiceRef.current = practice

  const animateCards = useCallback((kind: CardMotion['kind'], duration: number, cards?: GameTableCard[], count?: number) => {
    const id = Date.now() + Math.random()
    setMotion({ id, kind, cards, count })
    return new Promise<void>(resolve => window.setTimeout(() => {
      setMotion(current => current?.id === id ? null : current)
      resolve()
    }, settings.reducedMotion ? 60 : duration))
  }, [settings.reducedMotion])

  const showImpact = useCallback((type: GameImpact['type'], title: string, detail: string) => {
    const id = Date.now() + Math.random()
    setImpact({ id, type, title, detail })
    if (impactTimerRef.current) window.clearTimeout(impactTimerRef.current)
    impactTimerRef.current = window.setTimeout(() => setImpact(current => current?.id === id ? null : current), settings.reducedMotion ? 450 : type === 'success' ? 1400 : 1050)
  }, [settings.reducedMotion])

  useEffect(() => () => {
    if (impactTimerRef.current) window.clearTimeout(impactTimerRef.current)
  }, [])

  useEffect(() => { saveGameSettings(settings) }, [settings])

  const commitPractice = useCallback((next: PracticeGameState) => {
    practiceRef.current = next
    setPractice(next)
  }, [])
  const beginPracticeAction = useCallback(() => {
    if (practiceBusyRef.current) return false
    practiceBusyRef.current = true
    setBusy(true)
    return true
  }, [])
  const endPracticeAction = useCallback(() => {
    practiceBusyRef.current = false
    setBusy(false)
  }, [])

  const refresh = useCallback(async () => {
    if (!gameId || isBotMode) return
    try {
      const view = await loadGameView(gameId)
      if (versionRef.current !== null && view.state.version !== versionRef.current) {
        const result = view.state.lastResult
        if (result?.type === 'reveal') {
          void animateCards(result.userId === user?.id ? 'play-player' : 'play-opponent', 460)
        } else if (result?.type === 'ring' && result.correct && tableRef.current.length) {
          void animateCards(result.userId === user?.id ? 'collect-player' : 'collect-opponent', 820, tableRef.current)
        } else if (result?.type === 'ring' && !result.correct) {
          const penaltyCount = Math.max(1, view.players.length - 1)
          void animateCards(result.userId === user?.id ? 'penalty-player' : 'penalty-opponent', 900 + (penaltyCount - 1) * 90, undefined, penaltyCount)
        }
      }
      versionRef.current = view.state.version
      tableRef.current = view.state.table
      setPlayers(view.players)
      setState(view.state)
      setTheme(view.theme)
      if (view.state.rematchGameId) {
        navigate(`/game?game=${encodeURIComponent(view.state.rematchGameId)}`, { replace: true })
        return
      }
      if (view.state.phase === 'finished') {
        const winner = view.players.find(player => player.userId === view.state.winnerId)
        setMessage(winner?.userId === user?.id ? '승리했어요! 모든 카드를 모았습니다.' : `${winner?.nickname ?? '상대방'}님이 승리했어요.`)
      } else if (view.players.find(player => player.userId === user?.id)?.abandoned) {
        setMessage('재접속 제한 시간을 지나 게임에서 탈락했어요.')
      } else if (view.state.lastResult?.type === 'ring') {
        const actor = view.players.find(player => player.userId === view.state.lastResult?.userId)
        const mine = actor?.userId === user?.id
        setFeedback(mine ? (view.state.lastResult.correct ? 'success' : 'error') : null)
        if (mine && view.state.lastResult.correct) showImpact('success', '정답!', '공개된 카드를 모두 가져왔어요')
        else if (mine) showImpact('error', '오답!', '상대에게 벌칙 카드 1장씩 보냅니다')
        setMessage(view.state.lastResult.correct
          ? `${mine ? '정답이에요!' : `${actor?.nickname ?? '상대방'}님이 정답을 맞혔어요.`} 공개된 카드를 가져갑니다.`
          : `${mine ? '오답이에요.' : `${actor?.nickname ?? '상대방'}님이 잘못 울렸어요.`} 다른 플레이어에게 한 장씩 줍니다.`)
      } else if (view.state.currentTurn === user?.id) setMessage('내 차례예요. 아래 카드 더미를 누르세요.')
      else setMessage('상대방이 카드를 뒤집을 차례예요.')
    } catch (caught) { setMessage(gameErrorMessage(caught)) }
  }, [animateCards, gameId, isBotMode, navigate, showImpact, user?.id])

  const connection = useSessionHeartbeat('game', isBotMode ? null : gameId, () => void refresh())

  useEffect(() => {
    if (isBotMode) { setMessage('내 차례예요. 아래 카드 더미를 누르세요.'); return }
    if (!gameId) {
      setMessage('진행 중인 게임을 찾고 있어요.')
      void findMyActiveSession().then(session => {
        if (session?.type === 'game') navigate(`/game?game=${encodeURIComponent(session.gameId)}`, { replace: true })
        else setMessage('진행 중인 게임이 없습니다.')
      }).catch(() => setMessage('진행 중인 게임을 확인하지 못했습니다.'))
      return
    }
    void refresh()
    return subscribeToGame(gameId, () => void refresh())
  }, [gameId, isBotMode, navigate, refresh])

  // Realtime is the primary transport, but a browser can miss an update while
  // its websocket is reconnecting. Poll only on the low-activity result screen
  // so a unanimous rematch always moves every player to the same new game.
  useEffect(() => {
    if (isBotMode || !gameId || state.phase !== 'finished' || state.rematchGameId) return
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [gameId, isBotMode, refresh, state.phase, state.rematchGameId])

  useEffect(() => {
    if (!isBotMode || practice.phase !== 'playing' || busy || practicePauseVersion === practice.version || botActionVersionRef.current === practice.version) return
    botActionVersionRef.current = practice.version
    const config = practiceDifficulty[difficulty]
    const exactFive = practiceIsExactFive(practice)
    let botDecision = decideBotBell(practice, difficulty)
    if (testBotRing === 'wrong' && !forcedBotRingUsedRef.current && !exactFive && getPracticeTableCards(practice).length > 0) {
      forcedBotRingUsedRef.current = true
      botDecision = 'ring'
    }

    if (botDecision === 'ring') {
      setMessage(exactFive ? '봇도 다섯을 발견했어요. 누가 먼저 누를까요?' : '봇이 종을 누르려는 것 같아요...')
      const timer = window.setTimeout(async () => {
        const current = practiceRef.current
        if (current.version !== practice.version || current.phase !== 'playing' || !beginPracticeAction()) return
        const correct = practiceIsExactFive(current)
        playGameSound('bell', settings)
        const next = ringPracticeBell(current, 'bot')
        if (correct) {
          playGameSound('correct', settings)
          const cards = getPracticeTableCards(current).map(card => toTableCard('bot', card)).filter((card): card is GameTableCard => Boolean(card))
          await animateCards('collect-opponent', 820, cards)
        }
        if (!correct) {
          setFeedback('error')
          setMessage(practiceBotWrongPendingMessage)
          playGameSound('wrong', settings)
          await animateCards('penalty-opponent', 900, undefined, 1)
        }
        commitPractice(next)
        if (next.phase === 'playing') setPracticePauseVersion(next.version)
        setFeedback(correct ? null : 'error')
        setMessage(practiceBotRingMessage(next, correct))
        endPracticeAction()
      }, config.reactionMs)
      return () => window.clearTimeout(timer)
    }

    if (exactFive) {
      setMessage('같은 과일의 합이 5예요. 봇이 놓쳤습니다. 지금 종을 누르세요!')
      return
    }
    if (practice.turn !== 'bot') return
    setMessage('봇이 카드를 고르고 있어요...')
    const timer = window.setTimeout(async () => {
      const current = practiceRef.current
      if (current.version !== practice.version || current.phase !== 'playing' || current.turn !== 'bot' || !beginPracticeAction()) return
      playGameSound('card', settings)
      await animateCards('play-opponent', 460)
      const latest = practiceRef.current
      if (latest.version === current.version && latest.turn === 'bot') {
        const next = revealPracticeCard(latest, 'bot')
        commitPractice(next)
        setMessage(next.phase === 'finished' ? '내 카드가 모두 떨어져 봇이 승리했어요.' : '봇이 카드를 뒤집었어요. 다섯인지 확인하세요!')
      }
      endPracticeAction()
    }, config.revealMs)
    return () => window.clearTimeout(timer)
  }, [animateCards, beginPracticeAction, busy, commitPractice, difficulty, endPracticeAction, isBotMode, practice, practicePauseVersion, settings, testBotRing])

  useEffect(() => {
    if (practicePauseVersion === null) return
    const timer = window.setTimeout(() => setPracticePauseVersion(null), settings.reducedMotion ? 450 : 1400)
    return () => window.clearTimeout(timer)
  }, [practicePauseVersion, settings.reducedMotion])

  useEffect(() => {
    const finished = isBotMode ? practice.phase === 'finished' : state.phase === 'finished'
    if (!finished) return
    const won = isBotMode ? practice.winner === 'player' : state.winnerId === user?.id
    const key = `${isBotMode ? `practice-${practice.version}` : gameId}-${won ? 'win' : 'loss'}`
    if (resultFxRef.current === key) return
    resultFxRef.current = key
    playGameSound(won ? 'victory' : 'defeat', settings)
    vibrateGame(won ? [80, 50, 120] : [180], settings)
  }, [gameId, isBotMode, practice.phase, practice.version, practice.winner, settings, state.phase, state.winnerId, user?.id])

  const me = players.find(player => player.userId === user?.id)
  const practiceTop = getPracticeTopCards(practice)
  const playerCount = practice.playerDraw.length
  const botCount = practice.botDraw.length
  const playerFace = toTableCard('player', practiceTop.player)
  const botFace = toTableCard('bot', practiceTop.bot)
  const myTurn = isBotMode ? practice.phase === 'playing' && practice.turn === 'player' : state.currentTurn === user?.id
  const myCount = isBotMode ? playerCount : me?.cardCount ?? 0
  const winner = players.find(player => player.userId === state.winnerId)
  const bellLocked = isBotMode ? practice.bellLocked : state.lastResult?.type === 'ring'
  const opponents = isBotMode ? [] : players.filter(player => player.userId !== user?.id)
  const turnPlayer = players.find(player => player.userId === state.currentTurn)
  const tableSeats = isBotMode
    ? [
        { id: 'bot', nickname: '봇', card: botFace, isMine: false, eliminated: botCount === 0 },
        { id: 'player', nickname: '나', card: playerFace, isMine: true, eliminated: playerCount === 0 },
      ]
    : players.map(player => ({
        id: player.userId,
        nickname: player.userId === user?.id ? '나' : player.nickname,
        card: state.table.find(card => card.userId === player.userId),
        isMine: player.userId === user?.id,
        eliminated: player.eliminated,
      }))

  const reveal = async () => {
    setFeedback(null)
    playGameSound('card', settings)
    if (isBotMode) {
      if (practice.phase !== 'playing' || practice.turn !== 'player' || playerCount <= 0 || !beginPracticeAction()) return
      await animateCards('play-player', 460)
      const next = revealPracticeCard(practiceRef.current, 'player')
      commitPractice(next)
      setMessage(next.phase === 'finished' ? '봇의 카드가 모두 떨어져 승리했어요!' : '카드를 뒤집었어요. 이제 봇 차례예요.')
      endPracticeAction()
      return
    }
    if (!gameId) return
    setBusy(true)
    try { await animateCards('play-player', 460); setState(await revealGameCard(gameId)); await refresh() }
    catch (caught) { setMessage(gameErrorMessage(caught)) }
    finally { setBusy(false) }
  }

  const ring = async () => {
    setFeedback(null)
    playGameSound('bell', settings)
    vibrateGame(35, settings)
    if (isBotMode) {
      if (practice.phase !== 'playing' || practice.bellLocked || getPracticeTableCards(practice).length === 0 || !beginPracticeAction()) return
      const correct = practiceIsExactFive(practice)
      setFeedback(correct ? 'success' : 'error')
      if (correct) {
        playGameSound('correct', settings)
        vibrateGame([45, 35, 70], settings)
        const cards = getPracticeTableCards(practice).map(card => ({ userId: 'player', fruit: card.fruit, count: card.count }))
        const next = ringPracticeBell(practiceRef.current, 'player')
        commitPractice(next)
        await animateCards('collect-player', 820, cards)
        showImpact('success', '정답!', '공개된 카드를 모두 가져왔어요')
        setMessage(next.phase === 'finished' ? '정답 종으로 승리했어요!' : '정답이에요! 공개된 카드를 모두 가져왔어요.')
      } else {
        playGameSound('wrong', settings)
        vibrateGame(140, settings)
        showImpact('error', '오답!', '봇에게 벌칙 카드 1장을 보냅니다')
        await animateCards('penalty-player', 900, undefined, 1)
        const next = ringPracticeBell(practiceRef.current, 'player')
        commitPractice(next)
        setMessage(next.phase === 'finished' ? '오답! 벌칙으로 마지막 카드를 잃어 패배했어요.' : '오답이에요! 봇에게 벌칙 카드 1장을 줬어요.')
      }
      endPracticeAction()
      return
    }
    if (!gameId) return
    setBusy(true)
    try {
      const result = await ringGameBell(gameId)
      if (!result.accepted) setMessage(result.reason === 'already_rung' ? '이번 카드에서는 이미 종이 울렸어요.' : '종을 울릴 수 없어요.')
      else {
        playGameSound(result.correct ? 'correct' : 'wrong', settings)
        vibrateGame(result.correct ? [45, 35, 70] : 140, settings)
      }
      await refresh()
    } catch (caught) { setMessage(gameErrorMessage(caught)) }
    finally { setBusy(false) }
  }

  const exitGame = async () => {
    setShowExitConfirm(false)
    if (isBotMode || !gameId || state.phase === 'finished') { navigate('/'); return }
    setBusy(true)
    try {
      await abandonGame(gameId)
      navigate('/', { replace: true })
    } catch (caught) {
      setMessage(gameErrorMessage(caught))
      setBusy(false)
    }
  }

  const rematch = async () => {
    if (!gameId || rematchBusy) return
    setRematchBusy(true)
    try {
      const result = await requestGameRematch(gameId)
      if (result.ready && result.gameId) navigate(`/game?game=${encodeURIComponent(result.gameId)}`, { replace: true })
      else {
        setState(result.state)
        setMessage('재경기를 요청했어요. 다른 플레이어를 기다리고 있어요.')
      }
    } catch (caught) { setMessage(gameErrorMessage(caught)) }
    finally { setRematchBusy(false) }
  }

  const returnToRoom = async () => {
    if (!gameId || roomBusy) return
    setRoomBusy(true)
    try {
      const room = await returnFinishedGameToRoom(gameId)
      navigate(`/room/${encodeURIComponent(room.id)}`, { replace: true })
    } catch (caught) { setMessage(gameErrorMessage(caught)); setRoomBusy(false) }
  }

  const restartPractice = () => {
    const next = createPracticeGame()
    botActionVersionRef.current = null
    forcedBotRingUsedRef.current = false
    practiceBusyRef.current = false
    setPracticePauseVersion(null)
    commitPractice(next)
    setFeedback(null)
    setBusy(false)
    setMessage('새 덱을 섞었어요. 내 카드 더미를 눌러 시작하세요.')
  }

  const resultRows = (state.playerResults ?? [])
    .map(result => ({ ...result, player: players.find(player => player.userId === result.userId) }))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  const myResult = state.playerResults?.find(result => result.userId === user?.id)
  const rematchUnavailable = Boolean(myResult?.abandoned || me?.abandoned || (state.rematchPlayerCount ?? players.length) < 2)
  const rematchRequested = Boolean(myResult?.rematchRequested || me?.rematchRequested)
  const cardBackStyle = !isBotMode && theme ? {
    background: theme.backAssetUrl ? `url("${theme.backAssetUrl}") center / cover no-repeat` : theme.backStyle.background ?? '#0878dd',
    color: theme.backStyle.accent ?? '#ffffff',
  } : undefined

  return (
    <div className="game-page game-page--arena">
      <header className="game-topbar">
        <button onClick={() => setShowExitConfirm(true)} aria-label="게임 나가기"><ChevronLeft /></button>
        <div><span>{(isBotMode ? practice.phase : state.phase) === 'finished' ? 'GAME OVER' : `ROUND ${isBotMode ? practice.stats.player.revealedCards + practice.stats.bot.revealedCards + 1 : state.round}`}</span><strong>{isBotMode ? 'BOT PRACTICE' : 'LIVE GAME'}</strong></div>
        <div><button onClick={() => setSettings(value => ({ ...value, muted: !value.muted }))} aria-label={settings.muted ? "소리 켜기" : "소리 끄기"}>{settings.muted ? <VolumeX /> : <Volume2 />}</button><button aria-label="게임 설정" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}><Settings /></button></div>
      </header>
      {!isBotMode && (!connection.online || !connection.serverConnected) && <div className="game-connection-banner" role="status">오프라인 상태예요. 연결이 복구될 때까지 게임 입력을 잠시 멈춥니다.</div>}

      <main className={`halli-arena ${motion?.kind.startsWith('collect-') ? 'is-collecting' : ''}`}>
        <section className={`arena-opponents arena-opponents--${isBotMode ? 1 : Math.max(1, opponents.length)}`} aria-label="상대 플레이어">
          {isBotMode ? <article className={`arena-station opponent-station ${practice.turn === 'bot' && practice.phase === 'playing' ? 'is-turn' : ''} ${botCount === 0 ? 'is-eliminated' : ''}`}><div className="station-profile"><span className="avatar avatar--2">BOT<i className="is-online" /></span><span><strong>연습 봇</strong></span><b>{botCount}장</b></div></article> : opponents.map((player, index) => <article className={`arena-station opponent-station ${player.isCurrentTurn ? 'is-turn' : ''} ${player.eliminated ? 'is-eliminated' : ''} ${!player.connected ? 'is-disconnected' : ''}`} key={player.userId}><div className="station-profile"><span className={`avatar avatar--${index + 1}`}>{player.nickname[0]}<i className={player.connected ? 'is-online' : 'is-offline'} /></span><span><strong>{player.nickname}</strong></span><b>{player.cardCount}장</b></div></article>)}
        </section>

        <section className="arena-center">
          <div className={`turn-pill ${myTurn ? 'is-mine' : ''}`}>{myTurn ? '내 차례' : isBotMode ? '봇 차례' : `${turnPlayer?.nickname ?? '상대'} 차례`}</div>
          <div className={`center-playfield center-playfield--${tableSeats.length}`}>
            <div className={`table-face-grid table-face-grid--${tableSeats.length}`} aria-label="공개 카드 영역">
              {tableSeats.map(seat => <FaceCard card={seat.card} owner={seat.nickname} theme={isBotMode ? null : theme} isMine={seat.isMine} eliminated={seat.eliminated} key={`${seat.id}-${seat.card?.cardId ?? 'empty'}`} />)}
            </div>
            <button className="arena-bell" onClick={() => void ring()} disabled={busy || me?.eliminated || (!isBotMode && (!connection.online || !connection.serverConnected)) || (isBotMode ? practice.phase : state.phase) === 'finished' || bellLocked || (isBotMode ? getPracticeTableCards(practice).length === 0 : state.table.length === 0)} aria-label="종 울리기"><span /><Bell /><strong>{bellLocked ? '다음 카드까지 대기' : '종 울리기'}</strong></button>
          </div>
          <div className={`arena-message ${feedback ? `is-${feedback}` : ''}`} aria-live="polite">{!isBotMode && state.phase === 'finished' && winner ? `${winner.nickname} 승리 · ` : ''}{message}</div>
        </section>

        <section className={`arena-station player-station ${myTurn ? 'is-turn' : ''} ${me?.eliminated ? 'is-eliminated' : ''}`} aria-label="내 플레이 영역">
          <div className="station-profile"><span className="avatar avatar--4">나<i className={!isBotMode && (!connection.online || !connection.serverConnected) ? 'is-offline' : 'is-online'} /></span><span><strong>{isBotMode ? '나' : me?.nickname ?? '플레이어'}</strong><small>{me?.eliminated ? '이번 게임에서 탈락' : !isBotMode && (!connection.online || !connection.serverConnected) ? '연결 복구 중' : myTurn ? '카드를 뒤집으세요' : isBotMode ? '봇 차례를 기다리는 중' : `${turnPlayer?.nickname ?? '상대'} 차례를 기다리는 중`}</small></span><b>{myCount}장</b></div>
          <div className="station-play player-play"><button className="player-deck" style={cardBackStyle} onClick={() => void reveal()} disabled={!myTurn || busy || (!isBotMode && (!connection.online || !connection.serverConnected)) || (isBotMode ? practice.phase : state.phase) === 'finished' || myCount === 0}><i /><i /><strong>{myCount}</strong><small>{myTurn ? '눌러서 뒤집기' : '상대 차례'}</small></button></div>
        </section>
        {motion && <div className={`card-motion-layer ${motion.kind}`} aria-hidden="true">{motion.kind.startsWith('play-') ? <div className="motion-card-back" style={cardBackStyle}><i /></div> : motion.kind.startsWith('penalty-') ? Array.from({ length: motion.count ?? 1 }, (_, index) => {
          const count = motion.count ?? 1
          const offset = count === 1 ? 0 : -150 + (300 * index) / Math.max(1, count - 1)
          return <div className="motion-card-back penalty-card" style={{ ...cardBackStyle, '--penalty-x': `${offset}px`, '--penalty-rotate': `${index % 2 ? 9 : -9}deg`, '--penalty-delay': `${index * 90}ms` } as CSSProperties} key={`${motion.id}-penalty-${index}`}><i /></div>
        }) : motion.cards?.map((card, index) => <div className={`motion-face-card motion-face-card--${index + 1}`} key={`${motion.id}-${index}`}><Fruit kind={card.fruit} count={card.count} /></div>)}</div>}
      </main>
      {impact && <div className={`game-impact is-${impact.type}`} role="status" aria-live="assertive"><div className="impact-burst" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i style={{ '--impact-angle': `${index * 30}deg` } as CSSProperties} key={index} />)}</div><strong>{impact.title}</strong><span>{impact.detail}</span></div>}
      {!isBotMode && state.phase === 'finished' && <section className="game-result-overlay" role="dialog" aria-modal="true" aria-labelledby="game-result-title">
        <div className="game-result-card">
          <span className="result-trophy"><Trophy /></span>
          <p>GAME COMPLETE</p>
          <h1 id="game-result-title">{state.winnerId === user?.id ? '승리했어요!' : `${winner?.nickname ?? '상대방'}님이 승리했어요.`}</h1>
          <small>최종 순위와 게임 기록을 확인해 보세요.</small>
          <ol className="game-result-list">
            {resultRows.map(result => <li className={result.userId === user?.id ? 'is-me' : ''} key={result.userId}>
              <b>{result.rank ?? '-'}위</b>
              <span className="avatar avatar--3">{result.player?.nickname[0] ?? '?'}</span>
              <span><strong>{result.player?.nickname ?? '플레이어'}{result.userId === user?.id ? ' · 나' : ''}</strong><small>{result.abandoned ? '게임 이탈' : `최종 ${result.totalOwned}장`}</small></span>
              <dl><div><dt>공개</dt><dd>{result.revealedCards}</dd></div><div><dt>정답</dt><dd>{result.correctRings}</dd></div><div><dt>획득</dt><dd>{result.cardsWon}</dd></div></dl>
            </li>)}
          </ol>
          <button className="primary-button full-button" onClick={() => void rematch()} disabled={rematchBusy || rematchRequested || rematchUnavailable}>
            <RotateCcw /> {rematchUnavailable ? '재경기 가능한 인원이 부족해요' : rematchRequested ? `재경기 대기 중 ${state.rematchRequestedCount ?? 0}/${state.rematchPlayerCount ?? players.length}` : rematchBusy ? '요청 중...' : '같은 방에서 다시 하기'}
          </button>
          <button className="secondary-button full-button" onClick={() => void returnToRoom()} disabled={roomBusy || rematchRequested}><LogOut /> {roomBusy ? '대기방 여는 중...' : '기존 대기방으로 돌아가기'}</button>
          <button className="secondary-button full-button" onClick={() => navigate('/', { replace: true })}><Home /> 홈으로 돌아가기</button>
        </div>
      </section>}
      {isBotMode && practice.phase === 'finished' && <section className="game-result-overlay" role="dialog" aria-modal="true" aria-labelledby="practice-result-title">
        <div className={`game-result-card practice-result-card ${practice.winner === 'player' ? 'is-win' : 'is-loss'}`}>
          <span className="result-trophy"><Trophy /></span>
          <p>PRACTICE COMPLETE · {difficulty === 'easy' ? '쉬움' : difficulty === 'hard' ? '어려움' : '보통'}</p>
          <h1 id="practice-result-title">{practice.winner === 'player' ? '연습 게임에서 승리했어요!' : '봇이 승리했어요.'}</h1>
          <small>전체 56장 덱으로 진행한 기록입니다.</small>
          <div className="practice-result-stats">
            <article><strong>나</strong><dl><div><dt>공개</dt><dd>{practice.stats.player.revealedCards}</dd></div><div><dt>정답</dt><dd>{practice.stats.player.correctRings}</dd></div><div><dt>오답</dt><dd>{practice.stats.player.wrongRings}</dd></div><div><dt>획득</dt><dd>{practice.stats.player.cardsWon}</dd></div></dl></article>
            <article><strong>연습 봇</strong><dl><div><dt>공개</dt><dd>{practice.stats.bot.revealedCards}</dd></div><div><dt>정답</dt><dd>{practice.stats.bot.correctRings}</dd></div><div><dt>오답</dt><dd>{practice.stats.bot.wrongRings}</dd></div><div><dt>획득</dt><dd>{practice.stats.bot.cardsWon}</dd></div></dl></article>
          </div>
          <button className="primary-button full-button" onClick={restartPractice}><RotateCcw /> 같은 난이도로 다시 연습</button>
          <button className="secondary-button full-button" onClick={() => navigate('/practice', { replace: true })}><Settings /> 난이도 다시 선택</button>
          <button className="secondary-button full-button" onClick={() => navigate('/', { replace: true })}><Home /> 홈으로 돌아가기</button>
        </div>
      </section>}
      {settingsOpen && <section className="game-settings-overlay" role="dialog" aria-modal="true" aria-labelledby="game-settings-title">
        <div className="game-settings-card">
          <header><div><Settings /><span><small>GAME SETTINGS</small><h2 id="game-settings-title">게임 환경 설정</h2></span></div><button aria-label="게임 설정 닫기" onClick={() => setSettingsOpen(false)}><X /></button></header>
          <label className="game-setting-toggle"><span><strong>효과음</strong><small>카드, 종, 판정 및 승패 효과음</small></span><input type="checkbox" checked={!settings.muted} onChange={event => setSettings(value => ({ ...value, muted: !event.target.checked }))} /></label>
          <label className="game-setting-range"><span><strong>음량</strong><output>{Math.round(settings.volume * 100)}%</output></span><input type="range" min="0" max="100" value={Math.round(settings.volume * 100)} disabled={settings.muted} onChange={event => setSettings(value => ({ ...value, volume: Number(event.target.value) / 100 }))} /></label>
          <label className="game-setting-toggle"><span><strong>진동</strong><small>지원 기기에서 종과 판정에 반응</small></span><input type="checkbox" checked={settings.vibration} onChange={event => setSettings(value => ({ ...value, vibration: event.target.checked }))} /></label>
          <label className="game-setting-toggle"><span><strong>모션 줄이기</strong><small>카드 이동 시간을 최소화합니다.</small></span><input type="checkbox" checked={settings.reducedMotion} onChange={event => setSettings(value => ({ ...value, reducedMotion: event.target.checked }))} /></label>
          <p>설정은 이 기기에 자동 저장됩니다.</p>
          <button className="primary-button full-button" onClick={() => setSettingsOpen(false)}>완료</button>
        </div>
      </section>}
      {showExitConfirm && <section className="game-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="exit-game-title">
        <div className="game-confirm-card"><LogOut /><h2 id="exit-game-title">게임에서 나갈까요?</h2><p>{isBotMode ? '현재 연습 기록은 저장되지 않아요.' : state.phase === 'finished' ? '게임 결과는 저장되어 있어요.' : '진행 중 나가면 기권 처리되고 남은 플레이어가 게임을 이어갑니다.'}</p><div><button className="secondary-button" onClick={() => setShowExitConfirm(false)}>계속 플레이</button><button className="danger-button" onClick={() => void exitGame()} disabled={busy}>게임 나가기</button></div></div>
      </section>}
    </div>
  )
}
