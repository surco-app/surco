import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { caseDir, FFMPEG, MUSIC } from '../../kit.mjs'

const dir = join(caseDir('carpeta'), 'pristine/Di Carlo')
rmSync(dir, { recursive: true, force: true })
for (const [from, to] of [['Get Up!', 'Get Up'], ['Fire Alert', 'Fire Alert']]) {
  mkdirSync(join(dir, to), { recursive: true })
  for (const file of readdirSync(join(MUSIC, 'Di Carlo', from)).filter((f) => f.endsWith('.wav'))) {
    const title = basename(file, '.wav')
    execFileSync(FFMPEG, [
      '-v', 'error', '-y', '-i', join(MUSIC, 'Di Carlo', from, file),
      '-map', '0:a', '-map_metadata', '-1', '-c:a', 'flac',
      '-metadata', `title=${title}`, '-metadata', 'artist=Di Carlo',
      join(dir, to, `${title}.flac`),
    ])
  }
}
