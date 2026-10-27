// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

// ArtworkTab reads window.api.platform at module scope (isMacOS), so the bridge must
// exist before the module loads — hence the dynamic import below.
import type { SyncedDraft } from '../../lib/settingsDraft'
;(window as unknown as { api: unknown }).api = { platform: 'darwin' }
const { ArtworkTab } = await import('./ArtworkTab')

afterEach(cleanup)

const synced = {
  coverMaxSize: '1200',
  coverSquare: false,
  coverUpscale: false,
  replaceLowResCover: false,
  flacFinderCovers: true,
} as unknown as SyncedDraft

describe('ArtworkTab', () => {
  // The 07/09 FLAC that went missing from a DJ's collection was blamed on this header,
  // so the option was locked while syncing to Traktor. On 27/10 the same DJ loaded a FLAC
  // carrying Surco's header into Traktor, closed it and found the track still there:
  // Traktor even rewrites the header with its own tags. The lock only took the covers away.
  it('offers the option with its usual hint while Traktor sync is on', () => {
    render(<ArtworkTab synced={{ ...synced, syncTraktor: true }} patch={vi.fn()} />)

    expect(screen.getByTestId('settings-flac-finder-covers')).toBeEnabled()
    expect(screen.getByText(i18n.t('settings.flacFinderCoversHint'))).toBeInTheDocument()
  })
})
