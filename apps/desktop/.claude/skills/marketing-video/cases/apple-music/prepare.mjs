import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { caseDir, FFMPEG, MUSIC } from '../../kit.mjs'

const dir = join(caseDir('apple-music'), 'in')
mkdirSync(dir, { recursive: true })
execFileSync(FFMPEG, [
  '-v', 'error', '-y',
  '-i', join(MUSIC, 'Tina Cousins/Pray/Pray (W.I.P. In The Church Mix).wav'),
  '-map_metadata', '-1', '-c', 'copy',
  join(dir, 'tina cousins - pray (church mix).wav'),
])
