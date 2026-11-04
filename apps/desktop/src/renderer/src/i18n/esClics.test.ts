import { expect, it } from 'vitest'
import es from './locales/es.json'

function leaves(obj: unknown, prefix = ''): [string, string][] {
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
  }
  return [[prefix, String(obj)]]
}

it('spells «clic» the Spanish way throughout, so the vinyl repair section never reads «clicks» in its header and «Clics» in its wave', () => {
  const english = leaves(es).filter(([, text]) => /click/i.test(text))
  expect(english).toEqual([])
})
