import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { caseDir, HERE } from './kit.mjs'

const cases = readdirSync(join(HERE, 'cases'))
const [name, ...flags] = process.argv.slice(2)
if (!cases.includes(name)) {
  console.error(`usage: node video.mjs <${cases.join('|')}> [--prepare] [--build-only]`)
  process.exit(2)
}
const run = (script, ...args) => execFileSync(process.execPath, [join(HERE, script), ...args], { stdio: 'inherit' })
const prepared = join(caseDir(name), '.prepared')
if (!flags.includes('--build-only')) {
  if (flags.includes('--prepare') || !existsSync(prepared)) {
    run(`cases/${name}/prepare.mjs`)
    writeFileSync(prepared, '')
  }
  run('tts.mjs', name)
  run(`cases/${name}/record.mjs`)
}
run('build.mjs', name)
