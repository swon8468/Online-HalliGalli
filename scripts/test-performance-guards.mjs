import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, main, friends, invites, matchmaking, rooms, inviteCenter, roomLobby, game] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/main.tsx', 'utf8'),
  readFile('src/lib/friends.ts', 'utf8'),
  readFile('src/lib/invites.ts', 'utf8'),
  readFile('src/lib/matchmaking.ts', 'utf8'),
  readFile('src/lib/rooms.ts', 'utf8'),
  readFile('src/components/InviteCenter.tsx', 'utf8'),
  readFile('src/pages/RoomLobby.tsx', 'utf8'),
  readFile('src/pages/Game.tsx', 'utf8'),
])

for (const moduleName of ['Game', 'AdminApp', 'CardDesigner', 'SpaceAdmin']) {
  assert.match(app, new RegExp(`const ${moduleName} = lazy\\(`), `${moduleName} 경로가 초기 앱 번들에 포함됩니다.`)
}
assert.match(main, /const AdminApp = lazy\(/, '관리자 호스트가 관리자 번들을 즉시 불러옵니다.')

for (const [name, source] of Object.entries({ friends, invites, matchmaking, rooms })) {
  assert.match(source, /replication_ready:\s*true/, `${name} Realtime replication 준비 확인이 없습니다.`)
  assert.match(source, /\.on\('system'/, `${name} Realtime replication 완료 복구가 없습니다.`)
}
assert.match(rooms, /status === 'CHANNEL_ERROR'/, '방·게임 Realtime 채널 오류 복구가 없습니다.')
assert.match(invites, /status === 'CHANNEL_ERROR'/, '초대 Realtime 채널 오류 복구가 없습니다.')
for (const [name, source] of Object.entries({ friends, inviteCenter, roomLobby, game })) {
  assert.match(source, /document\.visibilityState === 'visible'/, `${name} 폴백 조회가 백그라운드에서도 실행됩니다.`)
  assert.match(source, /addEventListener\('visibilitychange'/, `${name} 화면 복귀 동기화가 없습니다.`)
  assert.match(source, /removeEventListener\('visibilitychange'/, `${name} 화면 이벤트 정리가 없습니다.`)
}

assert.doesNotMatch(roomLobby, /setInterval\([^)]*,\s*2_000\)/, '대기방 전체 상태를 2초마다 조회합니다.')
assert.doesNotMatch(game, /setInterval\([^)]*,\s*1_000\)/, '완료 게임 전체 상태를 1초마다 조회합니다.')

console.log('verified route-level code splitting and visibility-aware Realtime reconciliation polling')
