// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReplacedEntry } from '../../../shared/toReview'
import '../i18n'
import { takeShortcutUndo } from '../lib/shortcutUndo'
import { ToastProvider } from '../lib/toastContext'
import { installApi } from '../test/api'
import { ReviewedButton } from './ReplacedReview'

const ENTRY: ReplacedEntry = {
  newPath: '/m/new.flac',
  oldPath: '/m/old.mp3',
  replacedAt: 1,
  shift: { moved: 12 },
  pending: ['rekordbox', 'traktor'],
}

afterEach(() => {
  cleanup()
  takeShortcutUndo()
  vi.unstubAllGlobals()
})

function setup() {
  const reviewReplaced = vi.fn(async () => ENTRY)
  const restoreReplaced = vi.fn(async () => {})
  installApi({ reviewReplaced, restoreReplaced })
  const dismiss = vi.fn()
  const reportUndo = vi.fn((_message: string, _onUndo: () => void) => dismiss)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider value={{ reportError: vi.fn(), reportUndo }}>
        <ReviewedButton path="/m/new.flac" name="Name" />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { reviewReplaced, restoreReplaced, reportUndo, dismiss }
}

describe('ReviewedButton', () => {
  // The DJ checked the cues by ear; the track is done in every program. Asking again, or
  // making them review it once per program, is friction for a step Undo already covers.
  it('takes the track out of every program at once, with no question asked', async () => {
    const { reviewReplaced, reportUndo } = setup()
    fireEvent.click(screen.getByTestId('cues-reviewed'))
    await waitFor(() => expect(reportUndo).toHaveBeenCalled())
    expect(reviewReplaced).toHaveBeenCalledWith('/m/new.flac', undefined)
    expect(reportUndo.mock.calls[0][0]).toBe('Reviewed · Name')
  })

  // A misclick must cost nothing: Undo brings back the entry with the programs it was
  // still pending in, not a fresh one that would list it everywhere again.
  it('puts the track back exactly as it was when the DJ presses Undo', async () => {
    const { restoreReplaced, reportUndo } = setup()
    fireEvent.click(screen.getByTestId('cues-reviewed'))
    await waitFor(() => expect(reportUndo).toHaveBeenCalled())
    reportUndo.mock.calls[0][1]()
    await waitFor(() => expect(restoreReplaced).toHaveBeenCalledWith(ENTRY))
  })

  // ⌘Z is the same Undo by keyboard, so it must also close the notice: a notice still
  // offering Undo after it was used would invite a second, meaningless restore.
  it('puts it back with ⌘Z too, and closes the notice', async () => {
    const { restoreReplaced, reportUndo, dismiss } = setup()
    fireEvent.click(screen.getByTestId('cues-reviewed'))
    await waitFor(() => expect(reportUndo).toHaveBeenCalled())
    const undo = takeShortcutUndo()
    expect(undo).not.toBeNull()
    undo?.()
    await waitFor(() => expect(restoreReplaced).toHaveBeenCalledWith(ENTRY))
    expect(dismiss).toHaveBeenCalled()
  })
})
