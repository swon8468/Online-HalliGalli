export interface PhysicalCard {
  id: string
  fruit: string
  count: number
}

export interface ShuffleViolationSummary {
  repeatedPlayerFaces: number
  repeatedConsecutiveRounds: number
  repeatedRecentTwoPlayerRounds: number
}

export interface ShuffleDeal<T extends PhysicalCard> {
  piles: T[][]
  flatDeck: T[]
  startSeat: number
  attempts: number
  usedFallback: boolean
  violations: ShuffleViolationSummary
}

export const SHUFFLE_POLICY_VERSION = 'constrained-rounds-v1'
export const DEFAULT_SHUFFLE_ATTEMPTS = 256

const faceKey = (card: PhysicalCard) => `${card.fruit}:${card.count}`

function randomIndex(length: number, random: () => number) {
  if (length <= 1) return 0
  const value = random()
  if (!Number.isFinite(value)) return 0
  return Math.min(length - 1, Math.max(0, Math.floor(value * length)))
}

export function fisherYates<T>(cards: readonly T[], random: () => number): T[] {
  const shuffled = [...cards]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1, random)
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }
  return shuffled
}

export function dealRoundRobin<T extends PhysicalCard>(flatDeck: readonly T[], playerCount: number, startSeat: number): T[][] {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new Error('playerCount must be between 2 and 6')
  }
  const normalizedStart = ((startSeat % playerCount) + playerCount) % playerCount
  const piles = Array.from({ length: playerCount }, () => [] as T[])
  flatDeck.forEach((card, index) => {
    piles[(normalizedStart + index) % playerCount].push(card)
  })
  return piles
}

export function inspectShuffle<T extends PhysicalCard>(piles: readonly (readonly T[])[]): ShuffleViolationSummary {
  let repeatedPlayerFaces = 0
  let repeatedConsecutiveRounds = 0
  let repeatedRecentTwoPlayerRounds = 0
  const rounds = Math.max(0, ...piles.map(pile => pile.length))
  const orderedRoundKeys: string[] = []
  const sortedTwoPlayerRoundKeys: string[] = []

  for (const pile of piles) {
    for (let index = 1; index < pile.length; index += 1) {
      if (faceKey(pile[index - 1]) === faceKey(pile[index])) repeatedPlayerFaces += 1
    }
  }

  for (let round = 0; round < rounds; round += 1) {
    const faces = piles.map(pile => pile[round]).filter((card): card is T => Boolean(card)).map(faceKey)
    const orderedKey = faces.join('|')
    if (round > 0 && orderedKey === orderedRoundKeys[round - 1]) repeatedConsecutiveRounds += 1
    orderedRoundKeys.push(orderedKey)

    if (piles.length === 2 && faces.length === 2) {
      const sortedKey = [...faces].sort().join('|')
      const recentStart = Math.max(0, sortedTwoPlayerRoundKeys.length - 4)
      if (sortedTwoPlayerRoundKeys.slice(recentStart).includes(sortedKey)) repeatedRecentTwoPlayerRounds += 1
      sortedTwoPlayerRoundKeys.push(sortedKey)
    }
  }

  return { repeatedPlayerFaces, repeatedConsecutiveRounds, repeatedRecentTwoPlayerRounds }
}

function violationScore(violations: ShuffleViolationSummary) {
  return violations.repeatedPlayerFaces * 100
    + violations.repeatedConsecutiveRounds * 20
    + violations.repeatedRecentTwoPlayerRounds * 5
}

export function shuffleAndDealCards<T extends PhysicalCard>(
  cards: readonly T[],
  playerCount: number,
  random: () => number = Math.random,
  maxAttempts = DEFAULT_SHUFFLE_ATTEMPTS,
): ShuffleDeal<T> {
  if (new Set(cards.map(card => card.id)).size !== cards.length) {
    throw new Error('physical card ids must be unique')
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be positive')

  let best: ShuffleDeal<T> | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const flatDeck = fisherYates(cards, random)
    const startSeat = randomIndex(playerCount, random)
    const piles = dealRoundRobin(flatDeck, playerCount, startSeat)
    const violations = inspectShuffle(piles)
    const candidate: ShuffleDeal<T> = {
      piles,
      flatDeck,
      startSeat,
      attempts: attempt,
      usedFallback: false,
      violations,
    }
    const score = violationScore(violations)
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
    if (score === 0) return candidate
  }

  if (!best) throw new Error('unable to shuffle cards')
  return { ...best, attempts: maxAttempts, usedFallback: true }
}
