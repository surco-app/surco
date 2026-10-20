// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { TrackCues } from '../../../shared/types'
import '../i18n'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

vi.mock('./CueWave', () => ({
  CueWave: ({ onPlace }: { onPlace?: (ms: number) => void }) => (
    <button type="button" data-testid="add-same" onClick={() => onPlace?.(128000)} />
  ),
}))

afterEach(cleanup)

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
    await waitFor(() => expect(screen.getByTestId('add-same')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('add-same'))
    fireEvent.click(screen.getByTestId('add-same'))
    fireEvent.click(screen.getByTestId('cues-save'))
    const [req] = saveRekordboxCues.mock.calls[0]
    expect(req.wanted.filter((c) => c.ms === 128000 && c.kind === 0)).toHaveLength(1)
    expect(req.wanted.filter((c) => c.ms === 128000 && c.kind !== 0)).toHaveLength(0)
    expect(req.wanted.filter((c) => c.kind !== 0)).toHaveLength(3)
  })
})
