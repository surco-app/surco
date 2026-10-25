import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { caseDir, FFMPEG, MUSIC, session } from '../../kit.mjs'

const dir = caseDir('calidad')
const pack = join(dir, 'in/Pack Hard House 2026')
rmSync(pack, { recursive: true, force: true })
mkdirSync(pack, { recursive: true })
const flac = (from, to) =>
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', join(MUSIC, from), '-c:a', 'flac', join(pack, to)])
flac('Barthezz/On The Move/On The Move (Original Mix).wav', 'Barthezz - On The Move (Original Mix).flac')
flac('Scott Brown/Now Is The Time/Now Is The Time.wav', 'Scott Brown - Now Is The Time.flac')
flac('Double You/Double You/Dancing With An Angel (Angel Mix).wav', 'Double You - Dancing With An Angel (Angel Mix).flac')
flac('Magic Affair/Magic Affair/Energy Of Light (Club Mix).wav', 'Magic Affair - Energy Of Light (Club Mix).flac')
flac('Greenfield/Violet Club Sandwich/Violet Club Sandwich (Original Mix).wav', 'Greenfield - Violet Club Sandwich (Original Mix).flac')
const mp3 = join(dir, 'lossy.mp3')
execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', join(MUSIC, 'Barthezz/Infected/01 Infected (Original Mix).wav'), '-c:a', 'libmp3lame', '-b:a', '128k', mp3])
execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', mp3, '-c:a', 'flac', '-sample_fmt', 's16', join(pack, 'Barthezz - Infected (Original Mix).flac')])
rmSync(mp3)

const s = await session('calidad', { searchProviders: [] })
try {
  await s.openFiles([pack])
  await s.page.waitForTimeout(90000)
  rmSync(join(dir, 'cache-seed'), { recursive: true, force: true })
  cpSync(join(dir, 'ud/analysis-cache'), join(dir, 'cache-seed'), { recursive: true })
} finally {
  await s.finish(false)
}
