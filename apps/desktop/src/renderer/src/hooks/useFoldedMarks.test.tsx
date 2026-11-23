// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFoldedMarks } from './useFoldedMarks'

afterEach(cleanup)
afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-wrapped') ? 16 : this.hasAttribute('data-dot') ? 5 : 2
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(16)
})

function Marks({ labels, wrapFrom }: { labels: string[]; wrapFrom: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const folded = useFoldedMarks(ref, labels.join('|'))
  return (
    <>
      <span ref={ref}>
        {labels.map((l, i) => (
          <span
            key={l}
            data-mark-label={l}
            data-dot={l === 'Unsaved' || undefined}
            data-wrapped={i >= wrapFrom || undefined}
          />
        ))}
      </span>
      <output data-testid="folded">{folded.join(' · ')}</output>
    </>
  )
}

describe('useFoldedMarks', () => {
  it('names the marks that dropped off the line, so none of them goes missing without a word', () => {
    render(<Marks labels={['Unsaved', 'Duplicate', 'Played', 'Backup']} wrapFrom={2} />)
    expect(screen.getByTestId('folded')).toHaveTextContent('Played · Backup')
  })

  it('reads a small dot after an icon as on the same line, though it sits lower inside it', () => {
    render(<Marks labels={['Duplicate', 'Unsaved', 'Played']} wrapFrom={9} />)
    expect(screen.getByTestId('folded').textContent).toBe('')
  })

  it('folds nothing in a row the browser has not laid out yet, such as one far off screen', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(0)
    render(<Marks labels={['Unsaved', 'Duplicate', 'Played']} wrapFrom={9} />)
    expect(screen.getByTestId('folded').textContent).toBe('')
  })

  it('names nothing while every mark fits', () => {
    render(<Marks labels={['Unsaved', 'Duplicate']} wrapFrom={9} />)
    expect(screen.getByTestId('folded').textContent).toBe('')
  })
})
