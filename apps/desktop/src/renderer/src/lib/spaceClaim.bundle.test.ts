import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The claim registry holds module-level state: an open section registers its handlers
// and the global keydown listener reads them back. The listener ships in the entry
// chunk and the sections in the lazy editor one, so with no manualChunks rule Rollup
// COPIED the module into both — two stacks, and every claim registered in one was
// invisible to the other. Click repair's Space claim was broken in production that way
// while every unit test stayed green: Vitest runs one module graph, with no chunks at
// all, so this class of bug is invisible from inside the app's own tests.
//
// This is a WATCH, not a reproduction: with the current import graph Rollup no longer
// splits the module even without the manualChunks rule, so removing the rule does not
// make this fail today. Chunking follows the import graph, though, and the duplication
// appeared once already from an ordinary refactor — the rule pins the outcome and this
// test is what notices the day the pin stops holding.
//
// Skipped when there is no build to inspect; CI builds before testing.
describe('key-claim registry bundling', () => {
  const assets = join(__dirname, '../../../../out/renderer/assets')
  let files: string[] = []
  try {
    files = readdirSync(assets).filter((f) => f.endsWith('.js'))
  } catch {
    files = []
  }

  it.skipIf(files.length === 0)('keeps the registry in exactly one chunk', () => {
    // A string literal survives minification untouched, so counting the chunks that
    // carry the marker counts the chunks that own a copy of the stack.
    const owners = files.filter((f) =>
      readFileSync(join(assets, f), 'utf8').includes('surco/key-claims/single-instance'),
    )
    expect(owners).toHaveLength(1)
  })
})
