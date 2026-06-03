import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'

// Every visible string is keyed; a missing key silently falls back to the other
// language and ships an untranslated UI. Flattening both trees and comparing the
// key sets catches that before it reaches a build.
function keys(obj: unknown, prefix = ''): string[] {
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => keys(item, `${prefix}[${i}]`))
  }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

describe('locale parity', () => {
  it('es and en expose the exact same keys', () => {
    expect(keys(en).sort()).toEqual(keys(es).sort())
  })
})
