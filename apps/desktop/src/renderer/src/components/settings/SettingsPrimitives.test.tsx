// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SettingsCheckboxField,
  SettingsField,
  SettingsHint,
  SettingsHintsVisible,
  SettingsLabel,
  SettingsSection,
} from './SettingsPrimitives'

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
  it('sets a named section apart with a rule', () => {
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

    const [first, second] = screen.getAllByTestId('settings-section')
    expect(first).toHaveAttribute('data-ruled', 'false')
    expect(second).toHaveAttribute('data-ruled', 'true')
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
    expect(label).toHaveAttribute('data-nested', 'true')
    expect(heading).not.toHaveAttribute('data-nested')
  })
})

describe('search anchors', () => {
  it('marks a section with its search anchor so settings search can scroll to it', () => {
    render(
      <SettingsSection eyebrow="Traktor collection" searchId="traktorSync">
        <p />
      </SettingsSection>,
    )
    expect(screen.getByTestId('settings-section')).toHaveAttribute('data-search-id', 'traktorSync')
  })

  it('marks a field with its search anchor', () => {
    render(
      <SettingsField label="MP3 quality" searchId="mp3Quality">
        <input data-testid="mp3" />
      </SettingsField>,
    )
    expect(screen.getByTestId('mp3').closest('[data-search-id]')).toHaveAttribute(
      'data-search-id',
      'mp3Quality',
    )
  })

  it('marks a checkbox setting with its search anchor', () => {
    render(
      <SettingsCheckboxField
        testid="ascii"
        checked={false}
        onChange={() => {}}
        label="ASCII file names"
        searchId="asciiFileNames"
      />,
    )
    expect(screen.getByTestId('ascii').closest('[data-search-id]')).toHaveAttribute(
      'data-search-id',
      'asciiFileNames',
    )
  })

  it('marks a loose label with its search anchor', () => {
    render(<SettingsLabel searchId="theme">Appearance</SettingsLabel>)
    expect(screen.getByText('Appearance')).toHaveAttribute('data-search-id', 'theme')
  })
})

// "Inline explanations" off is a DJ saying he knows Settings by heart, so the lines that
// explain a control go. A line that says why a control is off or what is missing is not an
// explanation he has memorised, and without it a greyed control reads as broken.
describe('inline explanations', () => {
  function fields(visible?: boolean): void {
    const body = (
      <>
        <SettingsField label="Grouping" hint="What grouping fills">
          <input />
        </SettingsField>
        <SettingsCheckboxField
          testid="ascii"
          checked={false}
          onChange={() => {}}
          label="ASCII file names"
          hint="Why ASCII helps"
        />
        <SettingsHint data-testid="loose">How the cache works</SettingsHint>
        <SettingsHint data-testid="state" always>
          Choose a collection first
        </SettingsHint>
        <SettingsCheckboxField
          testid="auto"
          checked={false}
          onChange={() => {}}
          label="Auto-match"
          hint="Add a source first"
          hintAlways
          disabled
        />
      </>
    )
    render(
      visible === undefined ? (
        body
      ) : (
        <SettingsHintsVisible value={visible}>{body}</SettingsHintsVisible>
      ),
    )
  }

  it('shows every explanation while inline explanations are on', () => {
    fields(true)
    expect(screen.getByText('What grouping fills')).toBeInTheDocument()
    expect(screen.getByText('Why ASCII helps')).toBeInTheDocument()
    expect(screen.getByTestId('loose')).toBeInTheDocument()
    expect(screen.getByTestId('state')).toBeInTheDocument()
    expect(screen.getByText('Add a source first')).toBeInTheDocument()
  })

  it('hides the explanations but keeps what a control is missing while they are off', () => {
    fields(false)
    expect(screen.queryByText('What grouping fills')).not.toBeInTheDocument()
    expect(screen.queryByText('Why ASCII helps')).not.toBeInTheDocument()
    expect(screen.queryByTestId('loose')).not.toBeInTheDocument()
    expect(screen.getByTestId('state')).toBeInTheDocument()
    expect(screen.getByText('Add a source first')).toBeInTheDocument()
  })

  // Some hints carry the gap to the next control in their own margin (the Traktor sync row
  // to its collection.nml label). Hidden outright, the label sat glued to the buttons above,
  // so a hidden hint leaves an empty placeholder that keeps that spacing and says nothing.
  it('keeps the space a hidden explanation gave the next control, with no text in it', () => {
    render(
      <SettingsHintsVisible value={false}>
        <SettingsHint data-testid="spaced" className="mt-2 mb-4">
          Converted tracks are written into the collection
        </SettingsHint>
      </SettingsHintsVisible>,
    )
    const space = screen.getByTestId('spaced-space')
    expect(space).toBeEmptyDOMElement()
    expect(space).toHaveAttribute('aria-hidden', 'true')
  })

  // The onboarding wizard draws the same fields with no Settings draft around them, and a
  // new user has never had the chance to turn explanations off.
  it('shows the explanations outside Settings', () => {
    fields()
    expect(screen.getByText('What grouping fills')).toBeInTheDocument()
    expect(screen.getByTestId('loose')).toBeInTheDocument()
  })
})
