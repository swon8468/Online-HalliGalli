import assert from 'node:assert/strict'
import { createPracticeGame } from '../src/game/practiceEngine.ts'

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 0x100000000
  }
}

const runs = Number(process.env.SHUFFLE_DIAGNOSTIC_RUNS ?? 10_000)
let repeatedFaces = 0
let duplicateIds = 0
let missingCards = 0

for (let run = 0; run < runs; run += 1) {
  const game = createPracticeGame(seededRandom(run + 1))
  const cards = [...game.playerDraw, ...game.botDraw]
  const ids = new Set(cards.map(card => card.id))
  if (cards.length !== 56) missingCards += 1
  if (ids.size !== cards.length) duplicateIds += 1

  for (const pile of [game.playerDraw, game.botDraw]) {
    for (let index = 1; index < pile.length; index += 1) {
      const previous = pile[index - 1]
      const current = pile[index]
      if (previous.fruit === current.fruit && previous.count === current.count) {
        repeatedFaces += 1
      }
    }
  }
}

console.log(JSON.stringify({ runs, repeatedFaces, duplicateIds, missingCards }))
assert.equal(missingCards, 0, '셔플 중 카드가 누락되면 안 됩니다.')
assert.equal(duplicateIds, 0, '셔플 중 물리 cardId가 복제되면 안 됩니다.')
assert.equal(repeatedFaces, 0, '가능한 덱에서 같은 플레이어의 연속 카드 앞면 반복은 없어야 합니다.')
