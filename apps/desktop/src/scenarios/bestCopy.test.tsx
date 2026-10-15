// @vitest-environment jsdom
import { join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/applemusic', async (original) => ({
  ...(await import('./fakeMusic')).appleMusicModule(await original()),
  scenarioFake: true,
}))
vi.mock('../main/appleMusicPlaylists', async () => (await import('./fakeMusic')).playlistsModule())
vi.mock('../main/appleMusicArtwork', async (original) =>
  (await import('./fakeMusic')).artworkModule(await original()),
)

import { type AppScenario, openApp } from './app'
import { music } from './fakeMusic'
import { makeTrack, scenarioDir } from './fixtures'

const SECONDS = 45
const MIX = `aevalsrc=0.3*sin(2*PI*440*t)+0.2*sin(2*PI*1234.5*t)+0.2*sin(2*PI*3170.3*t):s=44100:d=${SECONDS}`
const TAGS = { title: 'Netzwerk', artist: 'Klangkarussell' }

// One master twice: the open copy as mastered, the other pushed +12 dB into a limiter, the
// way a loudness-war reissue squares off the peaks. Same format family
// and same bandwidth, so only the level probes on a confirmed same-master pair can tell
// them apart, which is the case the feature was built for.
function twoCopies(name: string): { open: string; limited: string } {
  const root = scenarioDir(name)
  return {
    open: makeTrack(join(root, 'Downloads', 'Netzwerk.aiff'), {
      ...TAGS,
      lavfi: `${MIX},volume=0.9`,
    }),
    limited: makeTrack(join(root, 'Music', 'Netzwerk.wav'), {
      ...TAGS,
      lavfi: `${MIX},volume=4,alimiter=limit=0.5:level=false`,
    }),
  }
}

describe.skipIf(process.platform !== 'darwin')(
  'See that the copy in hand beats the one already in Apple Music',
  () => {
    let surco: AppScenario
    let verdict: HTMLElement

    beforeAll(async () => {
      const { open, limited } = twoCopies('best-copy-library')
      music.reset()
      music.addEntry({ location: limited, ...TAGS, durationSec: SECONDS })
      surco = await openApp({ settings: {}, destination: 'appleMusic' })
      await surco.drop(open)
      await surco.select(TAGS.title)
      verdict = await waitFor(
        () => {
          const pill = screen.getByTestId('copy-verdict')
          if (pill.getAttribute('data-state') === 'measuring')
            throw new Error('scenario: the copies are still being measured')
          return pill
        },
        { timeout: 90_000 },
      )
    }, 150_000)

    afterAll(() => {
      surco.close()
    })

    it('says the file in hand is the better copy', () => {
      expect(verdict.getAttribute('data-state')).toBe('here')
    })

    it('shows that the limiter, counted in peaks, is what decided', () => {
      fireEvent.click(verdict)
      expect(screen.getByTestId('copy-comparison')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Metadata' }).getAttribute('aria-expanded')).toBe(
        'true',
      )
      expect(screen.getByTestId('copy-row-peakCount').hasAttribute('data-decides')).toBe(true)
      expect(surco.errors).toEqual([])
    })
  },
)

describe.skipIf(process.platform !== 'darwin')(
  'Mark the best of two copies of a record in the list',
  () => {
    let surco: AppScenario

    beforeAll(async () => {
      const { open, limited } = twoCopies('best-copy-list')
      music.reset()
      surco = await openApp({ settings: {}, destination: 'beside' })
      await surco.drop(open, limited)
    }, 60_000)

    afterAll(() => {
      surco.close()
    })

    function rankOf(format: string): Promise<string> {
      return waitFor(
        () => {
          const row = screen
            .getAllByTestId('track-row')
            .find((r) => within(r).getByTestId('track-format-slot').textContent?.includes(format))
          if (!row) throw new Error(`scenario: no row shows a ${format}`)
          const rank = within(row).getByTestId('track-duplicate').getAttribute('data-rank')
          if (!rank) throw new Error('scenario: the duplicate has no rank yet')
          return rank
        },
        { timeout: 90_000 },
      )
    }

    it('marks the open AIFF as the copy to keep and the limited WAV as the worse one', async () => {
      expect(await rankOf('AIFF')).toBe('best')
      expect(await rankOf('WAV')).toBe('worse')
      expect(surco.errors).toEqual([])
    }, 120_000)
  },
)
