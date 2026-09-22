// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import '../../i18n'
import { AdvancedDisclosure, SettingsAdvancedProvider, SettingsSection } from './SettingsPrimitives'

afterEach(cleanup)

// Reported 14/09 with a screenshot of the Output tab: "the Traktor and the rekordbox
// section are practically indistinguishable". They were separated by a 10px label in dim
// grey and a 1px rule at 9% opacity — the smallest type on the screen carrying the job of
// saying where one collection ends and the next begins. Six tabs share this component,
// and Search stacks eleven sections under it.

describe('SettingsSection', () => {
  it('names the section it holds', () => {
    render(
      <SettingsSection eyebrow="Colección de rekordbox">
        <p>contenido</p>
      </SettingsSection>,
    )

    expect(screen.getByTestId('settings-section')).toHaveTextContent('Colección de rekordbox')
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  // Containment is what makes two stacked sections read as two things: a surface of its
  // own, with an edge that closes underneath. A rule between them only marks the seam, and
  // at 9% opacity it barely does that.
  it('gives a named section its own surface', () => {
    render(
      <SettingsSection eyebrow="Traktor">
        <p>uno</p>
      </SettingsSection>,
    )

    const section = screen.getByTestId('settings-section')
    expect(section.className).toMatch(/rounded/)
    expect(section.className).toMatch(/border/)
  })

  // A section with no name is a plain grouping of controls, not a titled block — boxing it
  // would draw a card around something that never asked to be one.
  it('leaves an unnamed section unboxed', () => {
    render(
      <SettingsSection>
        <p>suelto</p>
      </SettingsSection>,
    )

    expect(screen.getByTestId('settings-section').className).not.toMatch(/rounded/)
  })
})

// The rarely touched settings fold under one "Advanced" toggle per tab so the everyday ones
// lead. Folding must never cost a setting: the controls stay in the form, and one the
// browser refuses to submit opens its fold, or Save would do nothing with no field in view.
describe('AdvancedDisclosure', () => {
  it('starts folded and unfolds from its toggle', () => {
    render(
      <AdvancedDisclosure id="general">
        <p>raro</p>
      </AdvancedDisclosure>,
    )

    const toggle = screen.getByTestId('settings-advanced-general')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('raro')).not.toBeVisible()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('raro')).toBeVisible()
  })

  it('unfolds when a field inside it blocks the form from submitting', () => {
    render(
      <form>
        <AdvancedDisclosure id="destination">
          <input data-testid="limit" type="number" min={1} defaultValue={0} />
        </AdvancedDisclosure>
      </form>,
    )

    const form = screen.getByTestId('limit').closest('form') as HTMLFormElement
    let valid = true
    act(() => {
      valid = form.checkValidity()
    })
    expect(valid).toBe(false)
    expect(screen.getByTestId('settings-advanced-destination')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByTestId('limit')).toBeVisible()
  })

  it('keeps each fold open across remounts while the shared state holds it', () => {
    function Harness({ show }: { show: boolean }): React.JSX.Element {
      return (
        <SettingsAdvancedProvider>
          {show && (
            <AdvancedDisclosure id="search">
              <p>oculto</p>
            </AdvancedDisclosure>
          )}
        </SettingsAdvancedProvider>
      )
    }
    const { rerender } = render(<Harness show />)
    fireEvent.click(screen.getByTestId('settings-advanced-search'))
    rerender(<Harness show={false} />)
    rerender(<Harness show />)
    expect(screen.getByTestId('settings-advanced-search')).toHaveAttribute('aria-expanded', 'true')
  })
})
