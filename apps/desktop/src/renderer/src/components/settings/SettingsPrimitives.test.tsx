// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsSection } from './SettingsPrimitives'

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
