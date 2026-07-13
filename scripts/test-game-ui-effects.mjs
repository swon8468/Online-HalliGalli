import { readFile } from 'node:fs/promises'

const game = await readFile('src/pages/Game.tsx', 'utf8')
const css = await readFile('src/styles.css', 'utf8')

const gameMarkers = [
  "'penalty-player'",
  "'penalty-opponent'",
  "showImpact('success', '정답!'",
  "showImpact('error', '오답!'",
  '벌칙 카드 1장을 보냅니다',
  'motion.count ?? 1',
  'game-impact is-${impact.type}',
]

for (const marker of gameMarkers) {
  if (!game.includes(marker)) throw new Error(`게임 판정/이동 효과가 누락됐습니다: ${marker}`)
}

const cssMarkers = [
  '.opponent-station{width:100%;height:46px',
  '.table-face-grid .arena-face-card',
  'width:108px;height:150px',
  ':nth-child(2){transform:translateY(-4px) rotate(6deg)',
  '@keyframes penaltyToOpponents',
  '@keyframes penaltyToPlayer',
  '.arena-message.is-error',
  '.game-impact.is-success',
  '.game-impact.is-error',
]

for (const marker of cssMarkers) {
  if (!css.includes(marker)) throw new Error(`게임 화면 스타일이 누락됐습니다: ${marker}`)
}

const desktopCenter = css.match(/\.table-face-grid \.arena-face-card[^\n]+width:(\d+)px;height:(\d+)px/)
const playerDeck = css.match(/\.player-deck\{[^}]*width:(\d+)px;height:(\d+)px/)
if (!desktopCenter || !playerDeck) throw new Error('중앙 카드와 내 덱 크기를 비교할 수 없습니다.')
if (Number(desktopCenter[1]) <= Number(playerDeck[1]) || Number(desktopCenter[2]) <= Number(playerDeck[2])) {
  throw new Error('중앙 공개 카드는 내 카드 덱보다 커야 합니다.')
}

console.log('verified compact opponent profile, enlarged rotating table cards, penalty travel, large feedback, and full-screen success/error effects')
