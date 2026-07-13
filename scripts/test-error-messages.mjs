import assert from 'node:assert/strict'
import { getErrorMessage } from '../src/lib/errorMessage.ts'

assert.equal(getErrorMessage(new Error('network failed')), 'network failed')
assert.equal(getErrorMessage({ message: 'already_friends', code: 'P0001' }), 'already_friends')
assert.equal(getErrorMessage('room_full'), 'room_full')
assert.equal(getErrorMessage({ code: 'P0001' }, '안전한 오류 안내'), '안전한 오류 안내')
assert.equal(getErrorMessage(null, '안전한 오류 안내'), '안전한 오류 안내')
assert.equal(getErrorMessage({ message: {} }, '안전한 오류 안내'), '안전한 오류 안내')

console.log('Error message extraction tests passed.')
