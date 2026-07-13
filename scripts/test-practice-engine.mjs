import assert from 'node:assert/strict'
import {
  buildPracticeDeck,
  createPracticeGame,
  decideBotBell,
  getPracticeTableCards,
  practiceDifficulty,
  practiceIsExactFive,
  revealPracticeCard,
  ringPracticeBell,
} from '../src/game/practiceEngine.ts'

const deck = buildPracticeDeck()
assert.equal(deck.length, 56, '연습 덱은 56장이어야 합니다.')
for (const fruit of ['strawberry', 'banana', 'lime', 'plum']) {
  assert.equal(deck.filter(card => card.fruit === fruit).length, 14, `${fruit} 카드 수 오류`)
}
assert.deepEqual(
  [1, 2, 3, 4, 5].map(count => deck.filter(card => card.fruit === 'strawberry' && card.count === count).length),
  [5, 3, 3, 2, 1],
  '카드 수량별 장수 오류',
)

let state = createPracticeGame(() => 0.417)
assert.equal(state.playerDraw.length, 28)
assert.equal(state.botDraw.length, 28)
assert.equal(new Set([...state.playerDraw, ...state.botDraw].map(card => card.id)).size, 56)

state = revealPracticeCard(state, 'player')
assert.equal(state.turn, 'bot')
assert.equal(state.playerDraw.length, 27)
assert.throws(() => revealPracticeCard(state, 'player'), /not practice turn/, '연속 플레이어 입력이 차단되어야 합니다.')
state = revealPracticeCard(state, 'bot')
assert.equal(state.turn, 'player')
assert.equal(state.botDraw.length, 27)
assert.equal(getPracticeTableCards(state).length, 2)

const card = (id, fruit, count) => ({ id, fruit, count })
const exactState = {
  ...createPracticeGame(() => 0.2),
  playerDraw: [card('pd', 'banana', 1), card('pd2', 'lime', 1)],
  botDraw: [card('bd', 'plum', 1), card('bd2', 'lime', 2)],
  playerFace: [card('pf', 'strawberry', 2)],
  botFace: [card('bf', 'strawberry', 3)],
}
assert.equal(practiceIsExactFive(exactState), true)
const collected = ringPracticeBell(exactState, 'player')
assert.equal(collected.playerDraw.length, 4)
assert.equal(collected.playerFace.length + collected.botFace.length, 0)
assert.equal(collected.stats.player.correctRings, 1)
assert.equal(collected.stats.player.cardsWon, 2)
assert.equal(collected.turn, 'player')

const wrongState = {
  ...createPracticeGame(() => 0.3),
  playerDraw: [card('pay', 'banana', 1), card('keep', 'lime', 1)],
  botDraw: [card('receive', 'plum', 1), card('bot-keep', 'lime', 2)],
  playerFace: [card('wrong-face', 'strawberry', 1)],
  botFace: [card('wrong-bot-face', 'banana', 1)],
}
const penalized = ringPracticeBell(wrongState, 'player')
assert.equal(penalized.playerDraw.length, 1)
assert.equal(penalized.botDraw.length, 3)
assert.equal(penalized.stats.player.wrongRings, 1)
assert.equal(penalized.stats.player.cardsPaid, 1)
assert.equal(penalized.bellLocked, true)

const lastCardState = {
  ...createPracticeGame(() => 0.4),
  turn: 'player',
  playerDraw: [card('last', 'strawberry', 1)],
  botDraw: [card('winner-1', 'banana', 1), card('winner-2', 'lime', 1)],
  playerFace: [],
  botFace: [],
}
const finished = revealPracticeCard(lastCardState, 'player')
assert.equal(finished.phase, 'finished')
assert.equal(finished.winner, 'bot')
assert.throws(() => revealPracticeCard(finished, 'bot'), /finished/)

const exactFinishState = {
  ...exactState,
  playerDraw: [card('only-active', 'banana', 1)],
  botDraw: [],
}
const exactFinished = ringPracticeBell(exactFinishState, 'player')
assert.equal(exactFinished.phase, 'finished')
assert.equal(exactFinished.winner, 'player')
assert.throws(() => ringPracticeBell({ ...wrongState, playerDraw: [] }, 'player'), /eliminated/)

assert.equal(decideBotBell(exactState, 'easy', () => 0), 'ring')
assert.equal(decideBotBell(exactState, 'easy', () => 0.99), 'wait')
assert.equal(decideBotBell(wrongState, 'easy', () => 0), 'ring')
assert.equal(decideBotBell(wrongState, 'hard', () => 0.99), 'wait')
assert.ok(practiceDifficulty.easy.reactionMs > practiceDifficulty.normal.reactionMs)
assert.ok(practiceDifficulty.normal.reactionMs > practiceDifficulty.hard.reactionMs)
assert.ok(practiceDifficulty.easy.accuracy < practiceDifficulty.normal.accuracy)
assert.ok(practiceDifficulty.normal.accuracy < practiceDifficulty.hard.accuracy)

const conserved = collected.playerDraw.length + collected.botDraw.length + collected.playerFace.length + collected.botFace.length
assert.equal(conserved, 6, '카드 획득 전후 카드 수가 보존되어야 합니다.')

console.log('verified full 56-card bot practice engine')
console.log('deck, turn order, exact/wrong bell, collection, penalty, finish, rapid input guard, and difficulty policy passed')
