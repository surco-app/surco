// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS } from '../../../../shared/editorSections'
import type { SyncedDraft } from '../../lib/settingsDraft'
import '../../i18n'
import { LayoutTab } from './LayoutTab'

afterEach(cleanup)

const synced: SyncedDraft = {
  theme: 'system',
  language: 'system',
  outputFormat: 'aiff',
  keepMp3Sources: false,
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  addToEngineDj: false,
  engineDjPlaylist: 'Surco',
  traktorCueOffsetMs: '0',
  filenameFormat: '{artist} - {title}',
  titleFormat: '',
  autoApplyFilename: false,
  grouping: '',
  genre: '',
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  importFields: [],
  requiredFields: [],
  coverMaxSize: '1200',
  coverSquare: false,
  coverUpscale: false,
  replaceLowResCover: false,
  flacFinderCovers: false,
  mp3Quality: '320',
  outputBitDepth: 'source',
  outputSampleRate: 'source',
  flacCompression: '5',
  showSpectrum: true,
  showLoudness: true,
  showEditorHints: true,
  autoAnalyze: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  declick: 'off',
  shortcutOverrides: {},
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: '',
  editorSections: DEFAULT_EDITOR_SECTIONS,
}

function renderTab(over: Partial<SyncedDraft> = {}): ReturnType<typeof vi.fn> {
  const patch = vi.fn()
  render(<LayoutTab synced={{ ...synced, ...over }} patch={patch} />)
  return patch
}

// The editor's sections are the user's to arrange: which start open, and in what
// order they stack below the metadata form. One list in Settings → Editor rules both.
describe('LayoutTab sections', () => {
  it('lists every section in its configured order', () => {
    renderTab()
    const rows = screen.getAllByTestId(/^settings-section-row-/)
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'settings-section-row-form',
      'settings-section-row-otherTags',
      'settings-section-row-properties',
      'settings-section-row-quality',
      'settings-section-row-trim',
      'settings-section-row-declick',
      'settings-section-row-normalize',
      'settings-section-row-output',
    ])
  })

  it('patches the open flag when a section is toggled', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-section-open-properties'))
    expect(patch).toHaveBeenCalledWith(
      'editorSections',
      DEFAULT_EDITOR_SECTIONS.map((s) => (s.id === 'properties' ? { ...s, open: true } : s)),
    )
  })

  it('moves a section down one place', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-section-down-properties'))
    expect(patch).toHaveBeenCalledWith(
      'editorSections',
      ['form', 'otherTags', 'quality', 'properties', 'trim', 'declick', 'normalize', 'output'].map(
        (id) => DEFAULT_EDITOR_SECTIONS.find((s) => s.id === id),
      ),
    )
  })

  it('moves a section up one place', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-section-up-quality'))
    expect(patch).toHaveBeenCalledWith(
      'editorSections',
      ['form', 'otherTags', 'quality', 'properties', 'trim', 'declick', 'normalize', 'output'].map(
        (id) => DEFAULT_EDITOR_SECTIONS.find((s) => s.id === id),
      ),
    )
  })

  // Same gesture as Settings → Fields: the grip arms a drag and dropping on another
  // row lands the section there — one homogeneous reorder pattern across the app.
  it('reorders by dragging a row onto another', () => {
    const patch = renderTab()
    const dt = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.mouseDown(screen.getByTestId('settings-section-grip-output'))
    fireEvent.dragStart(screen.getByTestId('settings-section-row-output'), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByTestId('settings-section-row-normalize'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('settings-section-row-normalize'), { dataTransfer: dt })
    expect(patch).toHaveBeenCalledWith(
      'editorSections',
      ['form', 'otherTags', 'properties', 'quality', 'trim', 'declick', 'output', 'normalize'].map(
        (id) => DEFAULT_EDITOR_SECTIONS.find((s) => s.id === id),
      ),
    )
  })

  it('offers no grip on the pinned form row', () => {
    renderTab()
    expect(screen.queryByTestId('settings-section-grip-form')).not.toBeInTheDocument()
  })

  // Sections the user never touches (e.g. Properties) can be removed from the editor
  // entirely, not just folded — the eye toggle stages the hidden flag.
  it('patches the hidden flag when the eye is toggled', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-section-hide-properties'))
    expect(patch).toHaveBeenCalledWith(
      'editorSections',
      DEFAULT_EDITOR_SECTIONS.map((s) => (s.id === 'properties' ? { ...s, hidden: true } : s)),
    )
  })

  it('quiets the open pill while a section is hidden — a fold default means nothing then', () => {
    renderTab({
      editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
        s.id === 'properties' ? { ...s, hidden: true } : s,
      ),
    })
    expect(screen.getByTestId('settings-section-open-properties')).toBeDisabled()
  })

  it('offers no hide toggle on the form row — it is the editor itself', () => {
    renderTab()
    expect(screen.queryByTestId('settings-section-hide-form')).not.toBeInTheDocument()
  })

  // The eye's hint must come from the app's styled Tooltip, not the OS-grey native
  // title box that clashes with the theme.
  it('hints the eye with the styled tooltip, not a native title', () => {
    renderTab()
    const eye = screen.getByTestId('settings-section-hide-properties')
    expect(eye).not.toHaveAttribute('title')
    fireEvent.focusIn(eye)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hide section from the editor')
  })

  // Visible and Open are read as one pair of state columns, so "on" must look the same
  // in both: accent when active, dim when not. The eye used to sit at a fixed muted grey,
  // which left a visible section indistinguishable from a hidden one at a glance — the
  // struck-through name was the only cue.
  it('accents the eye while the section is visible and dims it once hidden', () => {
    renderTab()
    const eye = screen.getByTestId('settings-section-hide-properties')
    // quality starts open, so its pill is the accent-on reference the eye must match.
    const open = screen.getByTestId('settings-section-open-quality')
    expect(eye.className).toContain('text-[var(--color-accent)]')
    expect(eye.className).toBe(open.className)
  })

  it('dims the eye of a hidden section', () => {
    // Rendered hidden rather than clicked: the row is controlled by the parent, and
    // patch is a spy here, so a click never feeds the new state back in.
    renderTab({
      editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
        s.id === 'properties' ? { ...s, hidden: true } : s,
      ),
    })
    const eye = screen.getByTestId('settings-section-hide-properties')
    expect(eye.className).not.toContain('text-[var(--color-accent)]')
    expect(eye.className).toContain('text-fg-dim')
  })

  // The metadata form is the editor's fixed header: it can't move, and the first
  // movable section can't climb above it — so their arrows must not exist/act.
  it('offers no arrows on the form row and no up arrow past it', () => {
    renderTab()
    expect(screen.queryByTestId('settings-section-up-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-section-down-form')).not.toBeInTheDocument()
    // otherTags is the first reorderable section after the pinned form, so its up arrow
    // is disabled (nothing above it can be moved past the form).
    expect(screen.getByTestId('settings-section-up-otherTags')).toBeDisabled()
  })

  it('disables the last row’s down arrow', () => {
    renderTab()
    expect(screen.getByTestId('settings-section-down-output')).toBeDisabled()
  })

  // This list is the same kind of table as Settings → Fields: a name, repeating state
  // columns, then the reorder arrows. It read differently only because it was laid out with
  // justify-between, which lets every row place its controls wherever its own content ends.
  it('heads the visible and open columns', () => {
    renderTab()
    const head = screen.getByTestId('sections-columns')
    expect(head).toHaveTextContent(/visible/i)
    expect(head).toHaveTextContent(/open/i)
  })

  // The word is in the heading now, so repeating "Open" on every row said nothing — and it
  // was ambiguous besides: a greyed-out "Open" looked the same on a hidden section as on a
  // visible-but-closed one. A mark distinguishes them.
  it('shows no label text on the open toggle', () => {
    renderTab()
    expect(screen.getByTestId('settings-section-open-quality')).toHaveTextContent('')
  })

  it('still names the open toggle for a screen reader', () => {
    renderTab()
    expect(screen.getByTestId('settings-section-open-quality')).toHaveAccessibleName(/open/i)
  })

  // The pinned row carried a "FIXED" label in the arrows' place, which pushed its Open
  // control out of the column every other row uses — the first row, the one that sets how
  // the rest is read. Its lack of arrows already says it cannot move.
  it('lays the pinned row out on the same grid as the rest', () => {
    renderTab()
    const cols = (id: string) => screen.getByTestId(id).className.match(/grid-cols-\[[^\]]+\]/)?.[0]
    const pinned = cols('settings-section-row-form')
    // Asserted present, not just equal: with no grid at all both sides read undefined and
    // a bare equality check passes while the rows are back to placing their own controls.
    expect(pinned).toMatch(/^grid-cols-/)
    expect(cols('settings-section-row-quality')).toBe(pinned)
    expect(cols('sections-columns')).toBe(pinned)
  })
})
