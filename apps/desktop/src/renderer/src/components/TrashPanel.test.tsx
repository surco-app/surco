// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrashEntry } from '../../../shared/types'
import '../i18n'
import { formatBytes, TrashPanel } from './TrashPanel'

afterEach(cleanup)

const DAY = 24 * 60 * 60 * 1000

const entry = (over: Partial<TrashEntry> = {}): TrashEntry => ({
  id: 'e1',
  name: 'Track.aiff',
  originalPath: '/Music/Crate/Track.aiff',
  storedPath: '/ud/trash/items/e1-Track.aiff',
  bytes: 60 * 1024 * 1024,
  trashedAt: Date.now(),
  reason: 'replaced',
  ...over,
})

function renderPanel(entries: TrashEntry[], over: Partial<Parameters<typeof TrashPanel>[0]> = {}) {
  const props = {
    entries,
    retentionDays: 30,
    maxBytes: 10 * 1024 * 1024 * 1024,
    onRestore: vi.fn(),
    onRemove: vi.fn(),
    onEmpty: vi.fn(),
    onReveal: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<TrashPanel {...props} />)
  return props
}

describe('TrashPanel', () => {
  // The panel exists for one moment: a conversion went wrong and the user wants the
  // file back. The row has to name the file, where it lived and why it is here, and put
  // the way back one click away.
  it('lists each original with its folder and reason, and restores on click', () => {
    const props = renderPanel([entry(), entry({ id: 'e2', name: 'Other.wav', reason: 'renamed' })])
    const rows = screen.getAllByTestId('trash-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Track.aiff')
    expect(rows[0]).toHaveTextContent('/Music/Crate')
    expect(screen.getByTestId('trash-summary')).toHaveTextContent('2')
    fireEvent.click(screen.getAllByTestId('trash-restore')[1])
    expect(props.onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: 'e2' }))
  })

  // "Replaced by a conversion" without naming the file that took its place sends the user
  // to the folder to work out what happened. outputPath is already on the entry.
  it('names the file that took the original place', () => {
    renderPanel([entry({ outputPath: '/Music/Crate/Track.flac' })])
    expect(screen.getByTestId('trash-row')).toHaveTextContent('Track.flac')
  })

  it('falls back to the bare reason when nothing replaced the original', () => {
    renderPanel([entry({ reason: 'deleted' })])
    const row = screen.getByTestId('trash-row')
    expect(row).toHaveTextContent(/deleted from Surco/i)
  })

  // The sidebar navigates by reason, which is the only axis this list has. Its counts read
  // the whole trash, so they keep answering "what is in here" while a search narrows the rows.
  it('filters by reason from the sidebar without changing the counts', () => {
    renderPanel([
      entry({ id: 'a', reason: 'replaced' }),
      entry({ id: 'b', name: 'Renamed.mp3', reason: 'renamed' }),
    ])
    expect(screen.getByTestId('trash-filter-replaced')).toHaveTextContent('1')
    fireEvent.click(screen.getByTestId('trash-filter-renamed'))
    const rows = screen.getAllByTestId('trash-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Renamed.mp3')
    expect(screen.getByTestId('trash-filter-replaced')).toHaveTextContent('1')
  })

  // A replaced crate is looked up by the crate, not by each file's name.
  it('searches the name and the folder', () => {
    renderPanel([
      entry({ id: 'a', name: 'Pray.aiff', originalPath: '/Music/House/Pray.aiff' }),
      entry({ id: 'b', name: 'Jaguar.wav', originalPath: '/Music/Detroit/Jaguar.wav' }),
    ])
    fireEvent.change(screen.getByTestId('trash-search'), { target: { value: 'detroit' } })
    const rows = screen.getAllByTestId('trash-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Jaguar.wav')
  })

  // A search that matches nothing is not an empty trash: saying "nothing to restore" there
  // would tell the user their files are gone.
  it('tells a fruitless search apart from an empty trash', () => {
    renderPanel([entry()])
    fireEvent.change(screen.getByTestId('trash-search'), { target: { value: 'zzzz' } })
    expect(screen.getByTestId('trash-no-matches')).toBeInTheDocument()
    expect(screen.queryByTestId('trash-empty')).not.toBeInTheDocument()
  })

  // The trash deletes files by itself, which no OS trash does by default. The warning is
  // drawn only in the last week, where it means something — on every row it would be noise.
  it('warns only on the entries the sweep is about to take', () => {
    renderPanel([
      entry({ id: 'fresh', trashedAt: Date.now() }),
      entry({ id: 'soon', name: 'Soon.aiff', trashedAt: Date.now() - 28 * DAY }),
    ])
    const badges = screen.getAllByTestId('trash-expiring')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('2')
  })

  // The badge only appears on some rows, so it has to occupy a reserved lane rather than
  // push the buttons left: without one, Restore sits at a different x on every row that
  // is about to expire, and a long list has a column that wobbles as you scan it.
  it('keeps the actions in a fixed column whether or not a row warns', () => {
    renderPanel([
      entry({ id: 'fresh', trashedAt: Date.now() }),
      entry({ id: 'soon', trashedAt: Date.now() - 28 * DAY }),
    ])
    const lanes = screen.getAllByTestId('trash-expiring-lane')
    expect(lanes).toHaveLength(2)
    expect(lanes[0]).toBeEmptyDOMElement()
    expect(lanes[1]).not.toBeEmptyDOMElement()
  })

  // Switching filters changes how many rows are listed, and a dialog sized to its content
  // jumps — sidebar and footer with it — on every click. The height has to be set from the
  // viewport, so it cannot follow the row count. jsdom lays nothing out, so this can only
  // assert the height is declared at all; that it is the RIGHT height was checked against
  // the running app.
  it('declares its own height instead of growing with the rows', () => {
    renderPanel([entry()])
    // Anchored to a class boundary: \b would also match the h- inside max-h-[84vh], which
    // is a ceiling, not a height, and leaves the dialog free to shrink to its rows.
    expect(screen.getByTestId('trash-panel').className).toMatch(/(^|\s)h-\[\d+vh\]/)
  })

  it('shows how much room the trash takes when it is empty', () => {
    renderPanel([])
    expect(screen.getByTestId('trash-empty')).toBeInTheDocument()
    expect(screen.getByTestId('trash-usage')).toHaveTextContent('10 GB')
  })

  // Settings' rule: a control that is not available stays visible and disabled, so the
  // footer never changes shape between an empty and a full trash.
  it('keeps emptying visible but disabled when there is nothing to empty', () => {
    renderPanel([])
    expect(screen.getByTestId('trash-empty-button')).toBeDisabled()
  })

  // Emptying is the one irreversible action here, so it asks once, in place, and only
  // the second press fires.
  it('empties only after an inline confirmation', () => {
    const props = renderPanel([entry()])
    fireEvent.click(screen.getByTestId('trash-empty-button'))
    expect(props.onEmpty).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('trash-empty-confirm'))
    expect(props.onEmpty).toHaveBeenCalledTimes(1)
  })

  it('removes one entry and reveals the folder', () => {
    const props = renderPanel([entry()])
    fireEvent.click(screen.getByTestId('trash-remove'))
    expect(props.onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))
    fireEvent.click(screen.getByTestId('trash-reveal'))
    expect(props.onReveal).toHaveBeenCalledTimes(1)
  })
})

describe('formatBytes', () => {
  it('picks the unit a DJ reads sizes in', () => {
    expect(formatBytes(512, 'en')).toBe('512 B')
    expect(formatBytes(60 * 1024 * 1024, 'en')).toBe('60 MB')
    expect(formatBytes(1.5 * 1024 * 1024 * 1024, 'en')).toBe('1.5 GB')
  })
})
