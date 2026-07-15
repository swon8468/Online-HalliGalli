import assert from 'node:assert/strict'
import { buildPracticeDeck, createPracticeGame, practiceDifficulty } from '../src/game/practiceEngine.ts'
import { inspectShuffle, shuffleAndDealCards } from '../src/game/shufflePolicy.ts'

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 0x100000000
  }
}

function buildCustomDeck() {
  const quantities = [[1, 4], [2, 2], [3, 2], [4, 1], [5, 1]]
  return ['strawberry', 'banana', 'lime', 'plum'].flatMap(fruit => quantities.flatMap(([count, quantity]) =>
    Array.from({ length: quantity }, (_, copy) => ({ id: `custom:${fruit}:${count}:${copy}`, fruit, count }))))
}

function faceQuantities(cards) {
  const quantities = new Map()
  for (const card of cards) {
    const key = `${card.fruit}:${card.count}`
    quantities.set(key, (quantities.get(key) ?? 0) + 1)
  }
  return [...quantities].sort(([left], [right]) => left.localeCompare(right))
}

const defaultDeck = buildPracticeDeck()
const customDeck = buildCustomDeck()
const defaultQuantities = faceQuantities(defaultDeck)
const customQuantities = faceQuantities(customDeck)
const runs = Number(process.env.SHUFFLE_STAT_RUNS ?? 100_000)
const totalsByPlayerCount = new Map()
let fallbackCount = 0
let maxAttempts = 0
let defaultRuns = 0
let customRuns = 0

for (let run = 0; run < runs; run += 1) {
  const playerCount = 2 + (run % 5)
  const custom = run % 10 === 0
  const source = custom ? customDeck : defaultDeck
  const expectedQuantities = custom ? customQuantities : defaultQuantities
  const deal = shuffleAndDealCards(source, playerCount, seededRandom(0x9e3779b9 ^ (run + 1)))
  const dealt = deal.piles.flat()
  const violations = inspectShuffle(deal.piles)

  if (custom) customRuns += 1
  else defaultRuns += 1
  if (deal.usedFallback) fallbackCount += 1
  maxAttempts = Math.max(maxAttempts, deal.attempts)

  assert.equal(dealt.length, source.length, `run ${run}: card count changed`)
  assert.equal(new Set(dealt.map(card => card.id)).size, source.length, `run ${run}: duplicate physical card id`)
  assert.deepEqual(faceQuantities(dealt), expectedQuantities, `run ${run}: face quantities changed`)
  assert.deepEqual(violations, {
    repeatedPlayerFaces: 0,
    repeatedConsecutiveRounds: 0,
    repeatedRecentTwoPlayerRounds: 0,
  }, `run ${run}: constrained shuffle violation`)
  const pileSizes = deal.piles.map(pile => pile.length)
  assert.ok(Math.max(...pileSizes) - Math.min(...pileSizes) <= 1, `run ${run}: unfair per-game deal`)

  const totals = totalsByPlayerCount.get(playerCount) ?? Array.from({ length: playerCount }, () => 0)
  pileSizes.forEach((size, seat) => { totals[seat] += size })
  totalsByPlayerCount.set(playerCount, totals)
}

for (const [playerCount, totals] of totalsByPlayerCount) {
  const games = Math.ceil(runs / 5)
  // Six standard deviations for a uniformly randomized extra-card seat.
  const tolerance = Math.max(2, Math.ceil(3 * Math.sqrt(games)))
  assert.ok(Math.max(...totals) - Math.min(...totals) <= tolerance,
    `${playerCount} players: seat totals are biased (${totals.join(', ')})`)
}

for (const [difficultyIndex, difficulty] of Object.keys(practiceDifficulty).entries()) {
  for (let run = 0; run < 300; run += 1) {
    const game = createPracticeGame(seededRandom(0x51ed270b ^ (difficultyIndex * 10_000 + run)))
    assert.equal(new Set([...game.playerDraw, ...game.botDraw].map(card => card.id)).size, 56,
      `${difficulty} bot game duplicated a card`)
    assert.deepEqual(inspectShuffle([game.playerDraw, game.botDraw]), {
      repeatedPlayerFaces: 0,
      repeatedConsecutiveRounds: 0,
      repeatedRecentTwoPlayerRounds: 0,
    }, `${difficulty} bot game did not use the shared shuffle policy`)
  }
}

const rematchRandom = seededRandom(0x243f6a88)
for (let run = 0; run < 1_000; run += 1) {
  const first = shuffleAndDealCards(defaultDeck, 2, rematchRandom)
  const rematch = shuffleAndDealCards(defaultDeck, 2, rematchRandom)
  assert.notDeepEqual(rematch.flatDeck.map(card => card.id), first.flatDeck.map(card => card.id),
    'a rematch must use a new shuffle')
}

const unavoidable = Array.from({ length: 10 }, (_, index) => ({ id: `same:${index}`, fruit: 'lime', count: 1 }))
const fallback = shuffleAndDealCards(unavoidable, 2, seededRandom(7), 5)
assert.equal(fallback.usedFallback, true, 'mathematically unavoidable decks need a bounded fallback')
assert.equal(fallback.attempts, 5, 'fallback must stop at the configured attempt limit')
assert.equal(new Set(fallback.flatDeck.map(card => card.id)).size, unavoidable.length)

console.log(JSON.stringify({
  runs,
  defaultRuns,
  customRuns,
  fallbackCount,
  maxAttempts,
  seatTotals: Object.fromEntries(totalsByPlayerCount),
  botDifficulties: Object.keys(practiceDifficulty),
}))
