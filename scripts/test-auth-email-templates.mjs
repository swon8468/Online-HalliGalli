import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const directory = path.resolve('supabase/templates')
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))

assert.equal(manifest.length, 6, 'Supabase Auth 기본 인증 메일 6종을 관리해야 합니다.')
assert.equal(new Set(manifest.map(entry => entry.id)).size, manifest.length, '템플릿 ID는 중복될 수 없습니다.')
assert.equal(new Set(manifest.map(entry => entry.subjectKey)).size, manifest.length, '메일 제목 설정 키는 중복될 수 없습니다.')
assert.equal(new Set(manifest.map(entry => entry.contentKey)).size, manifest.length, '메일 본문 설정 키는 중복될 수 없습니다.')

for (const entry of manifest) {
  const content = await readFile(path.join(directory, entry.file), 'utf8')
  assert.match(entry.subject, /Halli Galli/, `${entry.id} 제목에 서비스명이 필요합니다.`)
  assert.match(content, /<html lang="ko">/, `${entry.id}는 한국어 문서여야 합니다.`)
  assert.doesNotMatch(content, /<script\b/i, `${entry.id}에 script를 포함할 수 없습니다.`)
  assert.doesNotMatch(content, /(?:src|href)=["']https?:\/\//i, `${entry.id}에 외부 리소스를 포함할 수 없습니다.`)
  assert.doesNotMatch(content, /tracking|pixel|utm_/i, `${entry.id}에 추적 코드를 포함할 수 없습니다.`)
  for (const placeholder of entry.requiredPlaceholders) {
    assert.ok(content.includes(placeholder), `${entry.id}에 ${placeholder} 변수가 필요합니다.`)
  }
}

console.log('Auth email template tests passed.')
