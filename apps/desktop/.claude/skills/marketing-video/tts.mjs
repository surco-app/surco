import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { caseDir, FFMPEG, HERE } from './kit.mjs'

const name = process.argv[2]
const voice = process.env.SURCO_VIDEO_VOICE || 'Mónica'
const lines = JSON.parse(readFileSync(join(HERE, 'cases', name, 'lines.json'), 'utf8'))
const dir = join(caseDir(name), 'tts')
mkdirSync(dir, { recursive: true })
const durations = {}
for (const line of lines) {
  const file = join(dir, `${line.id}.aiff`)
  execFileSync('say', ['-v', voice, '-r', '185', '-o', file, line.say])
  const probe = spawnSync(FFMPEG, ['-i', file, '-f', 'null', '-']).stderr.toString()
  durations[line.id] = Number(probe.split('time=').at(-1).split(/\s/)[0].split(':').at(-1))
  console.log(line.id, durations[line.id])
}
writeFileSync(join(caseDir(name), 'durations.json'), JSON.stringify(durations))
