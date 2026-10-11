import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('writes every test file under a per-run folder that a later run sweeps away', () => {
  const runs = join(process.env.SURCO_SYSTEM_TMPDIR ?? '', 'surco-tests')
  expect(tmpdir().startsWith(`${runs}/run-`)).toBe(true)
})
