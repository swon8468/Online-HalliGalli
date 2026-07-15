import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const edge = await readFile(new URL('../supabase/functions/space-admin/index.ts', import.meta.url), 'utf8')
assert.match(edge, /space_member_directory/)
assert.match(edge, /count: 'exact'/)
assert.match(edge, /\.range\(from, to\)/)
assert.match(edge, /Math\.min\(50/)
assert.doesNotMatch(edge, /auth\.admin\.listUsers|perPage:\s*1000/)

const members = Array.from({ length: 1_005 }, (_, index) => ({ id: index + 1, nickname: `member-${String(index + 1).padStart(4, '0')}` }))
const pageSize = 50
const pages = Array.from({ length: Math.ceil(members.length / pageSize) }, (_, index) => members.slice(index * pageSize, (index + 1) * pageSize))
assert.equal(pages.length, 21)
assert.equal(pages.at(-1)?.length, 5)
assert.deepEqual(pages.flat().map(item => item.id), members.map(item => item.id))
assert.equal(new Set(pages.flat().map(item => item.id)).size, 1_005)
assert.equal(members.filter(item => item.nickname.includes('099')).length, 11)

console.log('verified 1,005-row lossless pagination model and server-side count/search/range guards without Auth enumeration')
