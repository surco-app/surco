import { describe, expect, it } from 'vitest'
import { asGtagArguments } from './gtag'

// Both helpers below are copied verbatim from the gtag.js served for our own
// measurement ID. looksLikeArguments decides whether a queued item is an
// `arguments` object, and isGtagCommand is the branch that dispatches
// config/event/js/get. An item failing these is dropped without any error, which
// is how the site could load the tag while Analytics reported that data
// collection was never activated.
function looksLikeArguments(a: unknown): boolean {
  return (
    !!a &&
    (Object.prototype.toString.call(a) === '[object Arguments]' ||
      // biome-ignore lint/suspicious/noPrototypeBuiltins: kept verbatim from gtag.js
      Object.prototype.hasOwnProperty.call(a, 'callee'))
  )
}

function isGtagCommand(a: unknown): boolean {
  if (a == null || typeof a !== 'object') return false
  if ((a as { event?: unknown }).event) return true
  if (looksLikeArguments(a)) {
    const b = (a as unknown[])[0]
    return b === 'config' || b === 'event' || b === 'js' || b === 'get'
  }
  return false
}

describe('asGtagArguments', () => {
  it('marks the queued call so gtag.js dispatches it as a command', () => {
    expect(isGtagCommand(asGtagArguments(['config', 'G-TEST', {}]))).toBe(true)
    expect(isGtagCommand(asGtagArguments(['event', 'page_view', {}]))).toBe(true)
    expect(isGtagCommand(asGtagArguments(['js', new Date()]))).toBe(true)
  })

  it('is what a bare array lacks, which is why gtag.js silently ignored it', () => {
    expect(isGtagCommand(['event', 'page_view', {}])).toBe(false)
  })

  it('matches what the official snippet pushes', () => {
    const snippet = function (..._args: unknown[]): IArguments {
      // biome-ignore lint/complexity/noArguments: the point of the test is this exact object
      return arguments
    }
    const official = snippet('event', 'page_view', {})
    expect(looksLikeArguments(official)).toBe(true)
    expect(looksLikeArguments(asGtagArguments(['event', 'page_view', {}]))).toBe(true)
  })

  it('preserves the arguments so the payload still reaches Analytics', () => {
    const marked = asGtagArguments(['event', 'page_view', { page_path: '/guia' }])
    expect(Array.from(marked).slice(0, 2)).toEqual(['event', 'page_view'])
    expect(marked[2]).toEqual({ page_path: '/guia' })
  })
})
