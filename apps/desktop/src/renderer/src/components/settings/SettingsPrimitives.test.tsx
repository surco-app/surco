// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsField, SettingsSection } from './SettingsPrimitives'

afterEach(cleanup)

// Reported 14/09 with a screenshot of the Output tab: "the Traktor and the rekordbox
// section are practically indistinguishable". They were separated by a 10px label in dim
// grey and a 1px rule at 9% opacity — the smallest type on the screen carrying the job of
// saying where one collection ends and the next begins. The fix then was a box per named
// section; since 27/09 a named section is drawn like an editor section instead: a real
// heading with a rule above it, so Settings and the editor share one grammar and the boxes
// don't appear on two tabs only.

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

  // The name is a heading, so a screen reader can jump between Traktor and rekordbox the
  // way a sighted user tells them apart.
  it('names a section with a heading', () => {
    render(
      <SettingsSection eyebrow="Traktor">
        <p>uno</p>
      </SettingsSection>,
    )

    expect(screen.getByRole('heading', { name: 'Traktor' })).toBeInTheDocument()
  })

  // A rule above the heading marks where one section ends, as between editor sections; a
  // box around it is what only Search and Output had.
  it('sets a named section apart with a rule, not a box', () => {
    render(
      <>
        <SettingsSection eyebrow="Traktor" first>
          <p>uno</p>
        </SettingsSection>
        <SettingsSection eyebrow="rekordbox">
          <p>dos</p>
        </SettingsSection>
      </>,
    )

    const [, second] = screen.getAllByTestId('settings-section')
    expect(second.className).toMatch(/border-t/)
    expect(second.className).not.toMatch(/rounded/)
  })

  // Inside a named section a field's label is one step below the section's heading;
  // at the same size, "Discogs" and "Discogs token" read as two sections.
  it('keeps a field label inside a named section below its heading', () => {
    render(
      <SettingsSection eyebrow="Discogs">
        <SettingsField label="Discogs token">
          <input />
        </SettingsField>
      </SettingsSection>,
    )

    const heading = screen.getByRole('heading', { name: 'Discogs' })
    const label = screen.getByText('Discogs token')
    expect(label.className).not.toBe(heading.className)
    expect(label).not.toHaveClass('font-semibold')
  })
})
