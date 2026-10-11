import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOUR_MS = 60 * 60 * 1000

function remove(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    try {
      if (process.platform === 'darwin') execFileSync('chflags', ['-R', 'nouchg', dir])
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

process.env.SURCO_SYSTEM_TMPDIR ??= tmpdir()
const runs = join(process.env.SURCO_SYSTEM_TMPDIR, 'surco-tests')
mkdirSync(runs, { recursive: true })
for (const name of readdirSync(runs)) {
  const run = join(runs, name)
  const age = Date.now() - (statSync(run, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
  if (age > HOUR_MS) remove(run)
}
process.env.TMPDIR = mkdtempSync(join(runs, 'run-'))
