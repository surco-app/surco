import { expect, it } from 'vitest'
import es from './locales/es.json'

function leaves(obj: unknown, prefix = ''): [string, string][] {
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
  }
  return [[prefix, String(obj)]]
}

it('quotes the Spanish copy with «» throughout, so no screen or dialog mixes two quote styles', () => {
  const mixed = leaves(es).filter(([, text]) => /[“”"]/.test(text))
  expect(mixed).toEqual([])
})
