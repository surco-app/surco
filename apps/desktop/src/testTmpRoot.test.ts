import { tmpdir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/main'
import { expect, it } from 'vitest'

it('writes every test file under a per-run folder that a later run sweeps away', () => {
  const runs = join(process.env.SURCO_SYSTEM_TMPDIR ?? '', 'surco-tests')
  expect(tmpdir().startsWith(`${runs}/run-`)).toBe(true)
})

it('logs into the run folder, never into the real app log', () => {
  expect(log.transports.file.getFile().path.startsWith(`${tmpdir()}/`)).toBe(true)
})
