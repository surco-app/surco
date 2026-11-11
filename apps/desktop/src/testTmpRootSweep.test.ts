import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const appDir = resolve(__dirname, '..')
const vitest = join(dirname(createRequire(__filename).resolve('vitest/package.json')), 'vitest.mjs')

it('removes each test file run folder as soon as that file ends, so a day of suites cannot fill the disk', () => {
  const work = mkdtempSync(join(tmpdir(), 'sweep-'))
  const system = join(work, 'system')
  const fixture = join(work, 'writes.fixture.ts')
  writeFileSync(
    fixture,
    "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nimport { tmpdir } from 'node:os'\nit('writes', () => { writeFileSync(join(tmpdir(), 'audio.wav'), Buffer.alloc(1024)) })\n",
  )
  const config = join(work, 'vitest.config.mjs')
  writeFileSync(
    config,
    `export default { test: { root: ${JSON.stringify(appDir)}, globals: true, include: [${JSON.stringify(fixture)}], setupFiles: [${JSON.stringify(join(appDir, 'src/testTmpRoot.ts'))}] } }\n`,
  )
  execFileSync(process.execPath, [vitest, 'run', '--config', config], {
    cwd: appDir,
    env: { ...process.env, SURCO_SYSTEM_TMPDIR: system },
    stdio: 'pipe',
  })
  const runs = join(system, 'surco-tests')
  expect(existsSync(runs)).toBe(true)
  expect(readdirSync(runs).filter((name) => name.startsWith('run-'))).toEqual([])
}, 60_000)
