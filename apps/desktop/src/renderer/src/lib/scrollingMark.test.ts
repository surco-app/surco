// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installScrollingMark, SCROLL_MARK_MS } from './scrollingMark'

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('installScrollingMark', () => {
  // The bars are invisible at rest and show only while a pane is actually moving, the way
  // macOS draws overlay scrollbars. A :hover rule could not do it: Chromium keeps a custom
  // thumb painted after the pointer leaves, so one pass over the list left its bar up.
  it('marks a pane while it scrolls and clears the mark once it settles', () => {
    vi.useFakeTimers()
    const stop = installScrollingMark(document)
    const pane = document.createElement('div')
    document.body.append(pane)

    pane.dispatchEvent(new Event('scroll'))
    expect(pane.dataset.scrolling).toBe('')

    vi.advanceTimersByTime(SCROLL_MARK_MS - 1)
    pane.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(SCROLL_MARK_MS - 1)
    expect(pane.dataset.scrolling).toBe('')

    vi.advanceTimersByTime(1)
    expect(pane.dataset.scrolling).toBeUndefined()
    stop()
  })

  it('marks each pane on its own', () => {
    vi.useFakeTimers()
    const stop = installScrollingMark(document)
    const list = document.createElement('div')
    const editor = document.createElement('div')
    document.body.append(list, editor)

    list.dispatchEvent(new Event('scroll'))
    expect(list.dataset.scrolling).toBe('')
    expect(editor.dataset.scrolling).toBeUndefined()
    stop()
  })
})
