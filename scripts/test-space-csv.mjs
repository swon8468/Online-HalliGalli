import assert from 'node:assert/strict'
import { credentialsCsv, parseSpaceAccountsCsv, serializeCsv } from '../src/lib/spaceCsv.ts'

const parsed = parseSpaceAccountsCsv('\uFEFFemail,nickname,role,external_id\r\n"lee,qa@example.org","이,테스트",manager,"A-1"\r\nmember@example.org,멤버,member,B-2\r\n', ['@example.org'])
assert.equal(parsed.length, 2)
assert.equal(parsed[0].email, 'lee,qa@example.org')
assert.equal(parsed[0].nickname, '이,테스트')
assert.equal(parsed[0].role, 'manager')
assert.equal(parsed[0].externalId, 'A-1')
assert.deepEqual(parsed[0].errors, [])

const invalid = parseSpaceAccountsCsv('이메일,닉네임,역할\nmember@other.org,한,멤버\nmember@other.org,정상 이름,member', ['@example.org'])
assert.deepEqual(invalid[0].errors, ['표시 이름은 2~12자', '허용 도메인 불일치'])
assert.deepEqual(invalid[1].errors, ['허용 도메인 불일치', '파일 내 이메일 중복'])

assert.equal(serializeCsv([['a,b', 'say "hi"', 'line\nbreak']]), '\uFEFF"a,b","say ""hi""","line\nbreak"\r\n')
assert.match(credentialsCsv([{ email: 'a@example.org', nickname: 'A', role: 'member', password: 'secret', created: true }]), /temporary_password/)
assert.throws(() => parseSpaceAccountsCsv('email,nickname\n"broken,value', []), /따옴표/)
console.log('Space CSV parser/serializer tests passed.')
