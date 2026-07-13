import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : [join(directory, entry.name)]))
  return nested.flat().filter(file => /\.(tsx|css)$/.test(file))
}

const files = await sourceFiles('src')
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')])))
const all = [...sources.values()].join('\n')
const dialogs = [...all.matchAll(/<[^>]+role="dialog"[^>]*>/g)].map(match => match[0])
if (!dialogs.length) throw new Error('검사할 dialog가 없습니다.')
for (const dialog of dialogs) {
  if (!dialog.includes('aria-modal="true"') || !dialog.includes('aria-labelledby=')) throw new Error(`dialog 접근성 속성 누락: ${dialog.slice(0, 120)}`)
}
for (const [file, source] of sources) {
  for (const image of source.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(image[0])) throw new Error(`${file}: 이미지 대체 텍스트 누락`)
  }
}
if (!sources.get('src/components/Layout.tsx')?.includes('<DialogFocusManager />')) throw new Error('전역 모달 포커스 관리자가 연결되지 않았습니다.')
if (!sources.get('src/components/DialogFocusManager.tsx')?.includes("event.key !== 'Tab'")) throw new Error('모달 Tab 포커스 트랩이 없습니다.')
const css = sources.get('src/styles.css') ?? ''
for (const marker of [':focus-visible', '@media (pointer: coarse)', '@media (max-width: 360px)', '@media (prefers-reduced-motion: reduce)']) {
  if (!css.includes(marker)) throw new Error(`반응형/접근성 스타일 누락: ${marker}`)
}
const index = await readFile('index.html', 'utf8')
if (!index.includes('viewport-fit=cover')) throw new Error('safe-area viewport 설정 누락')

console.log(`verified ${dialogs.length} labelled modal dialogs, image alternatives, focus trapping, visible focus, touch targets, reduced motion, safe-area, and 360px safeguards`)
