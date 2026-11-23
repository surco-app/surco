// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { UnmovedReason } from '../../../shared/replaceShift'
import '../i18n'
import en from '../i18n/locales/en.json'
import { ReplacedPill, ReplacedReason } from './ReplacedPill'

afterEach(cleanup)

describe('ReplacedPill', () => {
  it('shows how far the cues moved, signed, so the DJ knows which way', () => {
    render(<ReplacedPill shift={{ moved: 120 }} />)
    const pill = screen.getByTestId('cues-replaced-pill')
    expect(pill).toHaveTextContent('+120 ms')
    expect(pill).toHaveAttribute('data-state', 'moved')
  })

  it('says not moved in amber with the reason below, so the DJ knows why to check', () => {
    render(
      <>
        <ReplacedPill shift={{ unmoved: 'drift' }} />
        <ReplacedReason shift={{ unmoved: 'drift' }} />
      </>,
    )
    const pill = screen.getByTestId('cues-replaced-pill')
    expect(pill).toHaveTextContent('not moved')
    expect(pill).toHaveAttribute('data-state', 'unmoved')
    expect(screen.getByTestId('cues-replaced-reason')).toHaveTextContent(
      en.editor.cues.replaced.drift,
    )
  })

  it('gives every unmoved reason its own sentence', () => {
    const reasons: UnmovedReason[] = ['noMatch', 'drift', 'unreadable']
    const texts = reasons.map((unmoved) => {
      const { unmount } = render(<ReplacedReason shift={{ unmoved }} />)
      const text = screen.getByTestId('cues-replaced-reason').textContent ?? ''
      unmount()
      return text
    })
    for (const text of texts) expect(text.trim()).not.toBe('')
    expect(new Set(texts).size).toBe(3)
  })

  it('adds no reason when the cues moved, since there is nothing to explain', () => {
    render(<ReplacedReason shift={{ moved: 0 }} />)
    expect(screen.queryByTestId('cues-replaced-reason')).toBeNull()
  })
})
