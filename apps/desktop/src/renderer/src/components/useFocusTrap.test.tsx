// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFocusTrap } from './useFocusTrap'

afterEach(cleanup)

function Dialog(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  return (
    <div ref={ref} role="dialog">
      <button type="button" data-testid="first">
        first
      </button>
      <button type="button" data-testid="last">
        last
      </button>
    </div>
  )
}

describe('useFocusTrap', () => {
  it('wraps Tab from the last focusable back to the first', () => {
    render(<Dialog />)
    screen.getByTestId('last').focus()
    fireEvent.keyDown(screen.getByTestId('last'), { key: 'Tab' })
    expect(screen.getByTestId('first')).toHaveFocus()
  })

  it('wraps Shift+Tab from the first focusable to the last', () => {
    render(<Dialog />)
    screen.getByTestId('first').focus()
    fireEvent.keyDown(screen.getByTestId('first'), { key: 'Tab', shiftKey: true })
    expect(screen.getByTestId('last')).toHaveFocus()
  })

  // Returning focus to the trigger is what lets a keyboard user carry on where
  // they were instead of being dropped at the top of the document.
  it('restores focus to the trigger when the dialog unmounts', () => {
    function CloseOnMount(): React.JSX.Element {
      const ref = useRef<HTMLDivElement>(null)
      useFocusTrap(ref)
      return <div ref={ref} role="dialog" />
    }
    function App(): React.JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" data-testid="trigger" onClick={() => setOpen((v) => !v)}>
            toggle
          </button>
          {open && <CloseOnMount />}
        </>
      )
    }
    render(<App />)
    const trigger = screen.getByTestId('trigger')
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(trigger).toHaveFocus()
  })
})
