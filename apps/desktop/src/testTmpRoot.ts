import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/main'
import { afterAll } from 'vitest'
import { setLibraryBackupRoot } from './main/libraryBackups'

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
const runDir = mkdtempSync(join(runs, 'run-'))
process.env.TMPDIR = runDir
log.transports.file.resolvePathFn = () => join(runDir, 'main.log')
setLibraryBackupRoot(join(runDir, 'backups'))
// Background work can still log once a file's tests are done; writing into the removed
// folder makes electron-log complain on the console after the worker has shut it down, and
// a console line still on its way when the worker closes fails the whole run. Scenarios that
// never close their app leave main's logging on, so every file silences both here.
afterAll(() => {
  log.transports.file.level = false
  log.transports.console.level = false
  remove(runDir)
})
