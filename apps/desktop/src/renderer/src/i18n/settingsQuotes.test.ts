import { expect, it } from 'vitest'
import es from './locales/es.json'

function leaves(obj: unknown, prefix = ''): [string, string][] {
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
  }
  return [[prefix, String(obj)]]
}

it('quotes the Spanish settings copy with «» throughout, so one hint never mixes two quote styles', () => {
  const mixed = leaves(es.settings, 'settings').filter(([, text]) => /[“”"]/.test(text))
  expect(mixed).toEqual([])
})
