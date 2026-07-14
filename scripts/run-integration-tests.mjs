import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const fileEnv = parseEnv(await readFile('.env.development', 'utf8'))
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || fileEnv.SUPABASE_ACCESS_TOKEN
if (!accessToken) throw new Error('개발 Supabase 통합 테스트에는 SUPABASE_ACCESS_TOKEN이 필요합니다.')
const password = process.env.TEST_USER_PASSWORD || `Test-${createHash('sha256').update(accessToken).digest('hex').slice(0, 18)}!`
const testEnvironment = { ...process.env, TEST_CREATE_USERS: '1', TEST_USER_PASSWORD: password }
const availableTests = [
  'test-game:completion',
  'test-game:engine',
  'test-session:recovery',
  'test-game:multiplayer',
  'test-matchmaking',
  'test-release-load',
  'test-friends',
  'test-invites',
  'test-push',
  'test-maintenance',
  'test-account',
  'test-waiting-room',
  'test-admin',
  'test-spaces',
  'test-cards',
  'test-custom-card-game',
  'test-security',
]
const requestedTests = process.argv.slice(2)
const unknownTests = requestedTests.filter(test => !availableTests.includes(test))
if (unknownTests.length > 0) throw new Error(`알 수 없는 통합 테스트: ${unknownTests.join(', ')}`)
const dependencies = new Map([
  ['test-cards', ['test-spaces']],
  ['test-custom-card-game', ['test-spaces']],
])
const selectedTests = new Set(requestedTests)
for (const requested of requestedTests) {
  for (const dependency of dependencies.get(requested) ?? []) selectedTests.add(dependency)
}
const tests = requestedTests.length > 0 ? availableTests.filter(test => selectedTests.has(test)) : availableTests

let failedTest = null
let cleanupFailed = false
try {
  for (const test of tests) {
    console.log(`\n[integration] ${test}`)
    const result = spawnSync('npm', ['run', test], { cwd: process.cwd(), env: testEnvironment, stdio: 'inherit' })
    if (result.status !== 0) {
      failedTest = test
      break
    }
  }
} finally {
  console.log('\n[integration] cleaning development fixtures')
  const cleanup = spawnSync('npm', ['run', 'test-fixtures:cleanup'], {
    cwd: process.cwd(),
    env: { ...testEnvironment, TEST_FIXTURE_CLEANUP: 'DELETE_DEVELOPMENT_TEST_FIXTURES' },
    stdio: 'inherit',
  })
  cleanupFailed = cleanup.status !== 0
}
if (cleanupFailed) throw new Error('개발 통합 테스트 fixture 정리 실패')
if (failedTest) throw new Error(`${failedTest} 실패`)
console.log(`\nverified all ${tests.length} development Supabase integration suites`)
