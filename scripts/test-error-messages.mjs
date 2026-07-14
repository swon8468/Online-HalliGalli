import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getErrorMessage } from '../src/lib/errorMessage.ts'

assert.equal(getErrorMessage(new Error('network failed')), 'network failed')
assert.equal(getErrorMessage({ message: 'already_friends', code: 'P0001' }), 'already_friends')
assert.equal(getErrorMessage('room_full'), 'room_full')
assert.equal(getErrorMessage({ code: 'P0001' }, '안전한 오류 안내'), '안전한 오류 안내')
assert.equal(getErrorMessage(null, '안전한 오류 안내'), '안전한 오류 안내')
assert.equal(getErrorMessage({ message: {} }, '안전한 오류 안내'), '안전한 오류 안내')
const authErrorSource = await readFile(new URL('../src/lib/authErrors.ts', import.meta.url), 'utf8')
assert.match(authErrorSource, /error sending.*email[\s\S]*인증 메일을 보내지 못했어요/i)
assert.match(authErrorSource, /includes\('smtp'\)[\s\S]*인증 메일 발송 설정을 확인할 수 없어요/i)
assert.match(authErrorSource, /rate limit[\s\S]*요청이 너무 많아요/i)

console.log('Error message extraction tests passed.')
