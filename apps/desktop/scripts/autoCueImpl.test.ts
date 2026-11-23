import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { autoCueImpl } from './autoCueImpl'

function desktopRoot(withBrain: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'auto-cue-impl-'))
  if (withBrain) {
    mkdirSync(join(root, 'brain'))
    writeFileSync(join(root, 'brain', 'index.ts'), 'export default {}\n')
  }
  return root
}

describe('autoCueImpl', () => {
  it('uses the private engine when it is checked out, so release builds ship the trained detector', () => {
    const root = desktopRoot(true)
    expect(autoCueImpl(root, {})).toBe(join(root, 'brain', 'index.ts'))
  })

  it('falls back to the basic engine in a public clone, so anyone can build Surco without the private repo', () => {
    const root = desktopRoot(false)
    expect(autoCueImpl(root, {})).toBe(join(root, 'src', 'shared', 'autoCue', 'basic.ts'))
  })

  it('refuses to build without the private engine when the release requires it, so a release never ships the basic one by accident', () => {
    const root = desktopRoot(false)
    expect(() => autoCueImpl(root, { SURCO_REQUIRE_BRAIN: '1' })).toThrow(
      'SURCO_REQUIRE_BRAIN is set but brain/index.ts is missing',
    )
  })

  it('builds with the private engine when the release requires it and it is there', () => {
    const root = desktopRoot(true)
    expect(autoCueImpl(root, { SURCO_REQUIRE_BRAIN: '1' })).toBe(join(root, 'brain', 'index.ts'))
  })
})
