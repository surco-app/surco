// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

afterEach(cleanup)
afterEach(resetEditorSections)

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 80,
    right: 400,
    bottom: 80,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

const READ: TrackCues = {
  contentId: '103',
  analysed: true,
  grid: Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 })),
  strong: [],
  phrases: [],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}

describe('CuesSection drops', () => {
  it('keeps one drop when the same position is added twice', async () => {
    const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
    installApi({
      rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => READ),
      saveRekordboxCues,
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsProvider settings={{ cueFlows: [MY_FLOW, ONE_AT_32], activeCueFlow: 'mine' }}>
          <CuesSection
            cue={{ contentId: '103', path: '/m/g.wav', label: 'Gowan' }}
            open
            onToggle={vi.fn()}
          />
        </SettingsProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 128 })
    fireEvent.mouseUp(window, { clientX: 128 })
    fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Enter' })
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    const [[req]] = saveRekordboxCues.mock.calls[0]
    expect(req.wanted.filter((c) => c.ms === 128000 && c.kind === 0)).toHaveLength(1)
    expect(req.wanted.filter((c) => c.ms === 128000 && c.kind !== 0)).toHaveLength(0)
    expect(req.wanted.filter((c) => c.kind !== 0)).toHaveLength(3)
  })
})
