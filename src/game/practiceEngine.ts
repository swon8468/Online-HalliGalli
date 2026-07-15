export type PracticeFruit = 'strawberry' | 'banana' | 'lime' | 'plum'
export type PracticeActor = 'player' | 'bot'
export type PracticeDifficulty = 'easy' | 'normal' | 'hard'

import { fisherYates, shuffleAndDealCards } from './shufflePolicy.ts'

export interface PracticeCard {
  id: string
  fruit: PracticeFruit
  count: number
}

export interface PracticeStats {
  revealedCards: number
  correctRings: number
  wrongRings: number
  cardsWon: number
  cardsPaid: number
}

export interface PracticeGameState {
  phase: 'playing' | 'finished'
  version: number
  turn: PracticeActor
  winner: PracticeActor | null
  playerDraw: PracticeCard[]
  botDraw: PracticeCard[]
  playerFace: PracticeCard[]
  botFace: PracticeCard[]
  bellLocked: boolean
  stats: Record<PracticeActor, PracticeStats>
}

export const practiceDifficulty = {
  easy: { reactionMs: 1900, revealMs: 2100, accuracy: 0.62, mistakeRate: 0.1 },
  normal: { reactionMs: 1050, revealMs: 1400, accuracy: 0.84, mistakeRate: 0.045 },
  hard: { reactionMs: 520, revealMs: 760, accuracy: 0.97, mistakeRate: 0.012 },
} as const

export const practiceBotWrongPendingMessage = '봇이 종을 잘못 눌렀어요! 벌칙 카드 1장을 받는 중이에요.'

export function practiceBotRingMessage(state: PracticeGameState, correct: boolean) {
  if (state.phase === 'finished') {
    return state.winner === 'player'
      ? '봇이 종을 잘못 눌러 마지막 카드를 잃었어요. 내가 승리했어요!'
      : '봇이 정답을 맞혀 게임에서 승리했어요.'
  }
  return correct
    ? '봇이 먼저 정답 종을 눌러 공개 카드를 가져갔어요.'
    : '봇이 종을 잘못 눌렀어요! 벌칙 카드 1장을 받았어요.'
}

const fruitTypes: PracticeFruit[] = ['strawberry', 'banana', 'lime', 'plum']
const countCopies = [[1, 5], [2, 3], [3, 3], [4, 2], [5, 1]] as const

export function buildPracticeDeck(): PracticeCard[] {
  return fruitTypes.flatMap(fruit => countCopies.flatMap(([count, copies]) =>
    Array.from({ length: copies }, (_, copy) => ({ id: `${fruit}-${count}-${copy}`, fruit, count }))))
}

export function shufflePracticeDeck(cards: PracticeCard[], random: () => number = Math.random): PracticeCard[] {
  return fisherYates(cards.map(card => ({ ...card })), random)
}

const emptyStats = (): PracticeStats => ({ revealedCards: 0, correctRings: 0, wrongRings: 0, cardsWon: 0, cardsPaid: 0 })

export function createPracticeGame(random: () => number = Math.random): PracticeGameState {
  const deal = shuffleAndDealCards(buildPracticeDeck(), 2, random)
  return {
    phase: 'playing', version: 0, turn: 'player', winner: null,
    playerDraw: deal.piles[0],
    botDraw: deal.piles[1],
    playerFace: [], botFace: [], bellLocked: false,
    stats: { player: emptyStats(), bot: emptyStats() },
  }
}

export function getPracticeTopCards(state: PracticeGameState) {
  return {
    player: state.playerFace.at(-1) ?? null,
    bot: state.botFace.at(-1) ?? null,
  }
}

export function getPracticeTableCards(state: PracticeGameState): PracticeCard[] {
  return [...state.playerFace, ...state.botFace]
}

export function practiceFruitTotals(state: PracticeGameState): Record<PracticeFruit, number> {
  const totals: Record<PracticeFruit, number> = { strawberry: 0, banana: 0, lime: 0, plum: 0 }
  const top = getPracticeTopCards(state)
  if (top.player) totals[top.player.fruit] += top.player.count
  if (top.bot) totals[top.bot.fruit] += top.bot.count
  return totals
}

export function practiceIsExactFive(state: PracticeGameState) {
  return Object.values(practiceFruitTotals(state)).some(total => total === 5)
}

function finishIfNeeded(state: PracticeGameState): PracticeGameState {
  if (practiceIsExactFive(state)) return state
  const playerActive = state.playerDraw.length > 0
  const botActive = state.botDraw.length > 0
  if (playerActive && botActive) return state
  const winner = playerActive ? 'player' : botActive ? 'bot' : null
  return { ...state, phase: 'finished', winner }
}

export function revealPracticeCard(state: PracticeGameState, actor: PracticeActor): PracticeGameState {
  if (state.phase !== 'playing') throw new Error('practice game is finished')
  if (state.turn !== actor) throw new Error('not practice turn')
  const drawKey = actor === 'player' ? 'playerDraw' : 'botDraw'
  const faceKey = actor === 'player' ? 'playerFace' : 'botFace'
  const other: PracticeActor = actor === 'player' ? 'bot' : 'player'
  const draw = state[drawKey]
  if (draw.length === 0) throw new Error('no practice cards')
  const next = draw[0]
  const nextState: PracticeGameState = {
    ...state,
    version: state.version + 1,
    turn: state[other === 'player' ? 'playerDraw' : 'botDraw'].length > 0 ? other : actor,
    [drawKey]: draw.slice(1),
    [faceKey]: [...state[faceKey], next],
    bellLocked: false,
    stats: {
      ...state.stats,
      [actor]: { ...state.stats[actor], revealedCards: state.stats[actor].revealedCards + 1 },
    },
  }
  return finishIfNeeded(nextState)
}

export function ringPracticeBell(state: PracticeGameState, actor: PracticeActor): PracticeGameState {
  if (state.phase !== 'playing') throw new Error('practice game is finished')
  if (state.bellLocked) throw new Error('practice bell is locked')
  const actorDrawKey = actor === 'player' ? 'playerDraw' : 'botDraw'
  if (state[actorDrawKey].length === 0) throw new Error('practice player eliminated')
  const other: PracticeActor = actor === 'player' ? 'bot' : 'player'
  const otherDrawKey = other === 'player' ? 'playerDraw' : 'botDraw'
  const correct = practiceIsExactFive(state)

  if (correct) {
    const collected = getPracticeTableCards(state)
    const nextState: PracticeGameState = {
      ...state,
      version: state.version + 1,
      turn: actor,
      [actorDrawKey]: [...state[actorDrawKey], ...collected],
      playerFace: [], botFace: [], bellLocked: true,
      stats: {
        ...state.stats,
        [actor]: {
          ...state.stats[actor],
          correctRings: state.stats[actor].correctRings + 1,
          cardsWon: state.stats[actor].cardsWon + collected.length,
        },
      },
    }
    return finishIfNeeded(nextState)
  }

  const paidCard = state[actorDrawKey][0]
  const nextState: PracticeGameState = {
    ...state,
    version: state.version + 1,
    [actorDrawKey]: paidCard ? state[actorDrawKey].slice(1) : state[actorDrawKey],
    [otherDrawKey]: paidCard ? [...state[otherDrawKey], paidCard] : state[otherDrawKey],
    bellLocked: true,
    stats: {
      ...state.stats,
      [actor]: {
        ...state.stats[actor],
        wrongRings: state.stats[actor].wrongRings + 1,
        cardsPaid: state.stats[actor].cardsPaid + (paidCard ? 1 : 0),
      },
    },
  }
  return finishIfNeeded(nextState)
}

export function decideBotBell(state: PracticeGameState, difficulty: PracticeDifficulty, random: () => number = Math.random): 'ring' | 'wait' {
  if (state.phase !== 'playing' || state.botDraw.length === 0 || state.bellLocked || getPracticeTableCards(state).length === 0) return 'wait'
  const config = practiceDifficulty[difficulty]
  return random() < (practiceIsExactFive(state) ? config.accuracy : config.mistakeRate) ? 'ring' : 'wait'
}
