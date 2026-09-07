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
  // A DJ's FLAC arrived at Surco on 07/09/2026 starting with 30,517 bytes of ID3 tag
  // before the "fLaC" magic — the shape this option produces. Decoders skip a leading
  // ID3 and play it fine, which is what the hint used to promise, but Traktor does not
  // accept the file at all and drops the track from its collection on the next write.
  // Anyone syncing to Traktor has to be told that before ticking the box, not after
  // their collection has lost the entry.
  it('warns that Traktor rejects the files this option produces', () => {
    render(<ArtworkTab synced={synced} patch={vi.fn()} />)

    const hint = screen.getByText(i18n.t('settings.flacFinderCoversHint'))
    expect(hint.textContent).toMatch(/traktor/i)
  })
})
