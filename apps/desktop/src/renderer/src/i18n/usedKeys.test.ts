import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'

// The parity test keeps the five locales in lockstep, which also means a dead key is
// paid five times: it stays translated in every language forever. This test closes the
// other gap — every key defined in en must be referenced somewhere in the app source,
// or it flags for deletion.

// The whole app tree counts, not just the renderer: the main process emits keys too
// (the activity log's `activity.*`). Locale JSONs are excluded — a key obviously
// "appears" in the file that defines it.
const SRC_ROOT = join(__dirname, '..', '..', '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return entry.name === 'locales' ? [] : sourceFiles(join(dir, entry.name))
    }
    // This file's own comments mention keys as examples; scanning itself would
    // count them as usage.
    if (entry.name === 'usedKeys.test.ts') return []
    return /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : []
  })
}

function leafKeys(obj: unknown, prefix = ''): string[] {
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

describe('locale key usage', () => {
  it('references every key en defines somewhere in the app source', () => {
    const source = sourceFiles(SRC_ROOT)
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    // Keys built at runtime appear in source as a template prefix — e.g.
    // `settings.provider.${p}` or `editor.channelMode${mode}` — so any key that
    // extends one of those prefixes counts as referenced.
    const dynamicPrefixes = [...source.matchAll(/[`'"]([A-Za-z0-9_.]+\.?)\$\{/g)].map((m) => m[1])
    // Every dotted word in the source and each of its dot-suffixes, read in one pass: a key
    // found here is referenced. One regex per key over the whole source took 6 s alone and
    // past the timeout under the full suite's load, so the regex only runs for the few keys
    // this set does not hold.
    const tokens = new Set(
      [...source.matchAll(/[\w-]+(?:\.[\w-]+)+/g)].flatMap((m) =>
        m[0].split('.').map((_, i, parts) => parts.slice(i).join('.')),
      ),
    )
    const orphans = leafKeys(en)
      // i18next resolves plural forms from the bare key, so the suffix never
      // appears in source.
      .map((key) => key.replace(/_(zero|one|two|few|many|other)$/, ''))
      .filter((key) => {
        if (tokens.has(key) || dynamicPrefixes.some((p) => key.startsWith(p))) return false
        // Substring alone would let a dead key hide behind a longer sibling
        // ('header.convert' inside 'header.convertingCount'), so the match must
        // end at a key boundary.
        const literal = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.])`)
        return !literal.test(source)
      })
    expect(orphans).toEqual([])
  })
})
