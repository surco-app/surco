import { describe, expect, it } from 'vitest'
import { toGtagArguments } from './gtag'

// looksLikeArguments is copied verbatim from the gtag.js served for our own
// measurement ID: it is the guard that decides whether a queued item is
// dispatched as a command or silently dropped. Checking against the real guard
// is what this test is for, since a dropped item raises no error and the only
// symptom is Analytics reporting that data collection was never activated.
function looksLikeArguments(a: unknown): boolean {
  return (
    !!a &&
    (Object.prototype.toString.call(a) === '[object Arguments]' ||
      // biome-ignore lint/suspicious/noPrototypeBuiltins: kept verbatim from gtag.js
      Object.prototype.hasOwnProperty.call(a, 'callee'))
  )
}

describe('toGtagArguments', () => {
  // Verified against the deployed site: an array carrying a `callee` property
  // satisfies the guard above yet still produces zero /g/collect hits, while a
  // genuine `arguments` object produces one. The tag must therefore be the real
  // thing, which is what this asserts.
  it('produces a genuine arguments object, not an array wearing a callee', () => {
    expect(Object.prototype.toString.call(toGtagArguments('event', 'page_view'))).toBe(
      '[object Arguments]',
    )
  })

  it('satisfies the guard gtag.js uses to dispatch a command', () => {
    expect(looksLikeArguments(toGtagArguments('config', 'G-TEST', {}))).toBe(true)
    expect(looksLikeArguments(toGtagArguments('js', new Date()))).toBe(true)
  })

  it('is what a bare array lacks, which is why gtag.js ignored the queue', () => {
    expect(looksLikeArguments(['event', 'page_view', {}])).toBe(false)
  })

  it('preserves the arguments so the payload still reaches Analytics', () => {
    const marked = toGtagArguments('event', 'page_view', { page_path: '/guia' })
    expect(Array.from(marked)).toEqual(['event', 'page_view', { page_path: '/guia' }])
  })
})
