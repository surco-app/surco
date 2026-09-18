// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrashEntry } from '../../../shared/types'
import '../i18n'
import { formatBytes, TrashPanel } from './TrashPanel'

afterEach(cleanup)

const entry = (over: Partial<TrashEntry> = {}): TrashEntry => ({
  id: 'e1',
  name: 'Track.aiff',
  originalPath: '/Music/Crate/Track.aiff',
  storedPath: '/ud/trash/items/e1-Track.aiff',
  bytes: 60 * 1024 * 1024,
  trashedAt: Date.parse('2026-09-18T10:00:00Z'),
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

  it('shows what it keeps and for how long when it is empty', () => {
    renderPanel([])
    expect(screen.getByTestId('trash-empty')).toBeInTheDocument()
    expect(screen.getByTestId('trash-summary')).toHaveTextContent('30')
    expect(screen.queryByTestId('trash-empty-button')).not.toBeInTheDocument()
  })

  // Emptying is the one irreversible action here, so it asks once, in place, and only
  // the second press fires.
  it('empties only after an inline confirmation', () => {
    const props = renderPanel([entry()])
    fireEvent.click(screen.getByTestId('trash-empty'))
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
