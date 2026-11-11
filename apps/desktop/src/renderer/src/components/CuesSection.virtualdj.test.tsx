// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { HOT_KINDS } from '../../../shared/cueRules'
import type { TrackCues } from '../../../shared/types'
import { resetEditorSections } from '../hooks/useEditorSections'
import i18n from '../i18n'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { djReads, installApi, type ProgramReads } from '../test/api'
import { CuesSection } from './CuesSection'

afterEach(cleanup)
afterEach(resetCueSession)
afterEach(resetEditorSections)

const ID = 'virtualdj:/Music/v.mp3'
const READ: TrackCues = {
  contentId: ID,
  analysed: true,
  grid: Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 })),
  strong: [],
  phrases: [],
  cues: [
    { id: '1', ms: 29973.878, kind: HOT_KINDS[0], color: 2, name: 'Surco' },
    { id: '2', ms: 57626.667, kind: HOT_KINDS[1], color: null },
  ],
  loops: [{ id: '1', startMs: 278306.667, endMs: 280097.779, name: 'loop' }],
  wave: null,
  durationMs: 428253,
  fingerprint: 'f0',
  gridFingerprint: '',
}

function setup(read: TrackCues | null = READ, running = false) {
  const save = vi.fn<Api['cues']['save']>(async () => {})
  installApi({
    dj: djReads({ virtualdj: { running: vi.fn<ProgramReads['running']>(async () => running) } }),
    cues: {
      trackCues: vi.fn<Api['cues']['trackCues']>(async () => read),
      queued: vi.fn<Api['cues']['queued']>(async () => null),
      save,
    },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{}}>
        <CuesSection
          cue={{ contentId: ID, path: '/Music/v.mp3', label: 'V' }}
          open
          onToggle={vi.fn()}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { save }
}

describe('CuesSection on a VirtualDJ track', () => {
  it('lists VirtualDJ’s hot cues and loops without the editor, since Surco cannot save them there', async () => {
    const { save } = setup()
    await waitFor(() => expect(screen.getByTestId('cues-read-only')).toBeInTheDocument())
    expect(screen.getByTestId('cues-read-only-A')).toHaveTextContent('0:29.9')
    expect(screen.getByTestId('cues-read-only-A')).toHaveTextContent('Surco')
    expect(screen.getByTestId('cues-read-only-B')).toHaveTextContent('0:57.6')
    expect(screen.getByTestId('cues-read-only-loop-1')).toHaveTextContent('4:38.3')
    expect(screen.getByTestId('cues-read-only-loop-1')).toHaveTextContent('4:40.0')
    expect(screen.getByTestId('cues-read-only')).toHaveTextContent(
      i18n.t('editor.cues.virtualdj.readOnly'),
    )
    expect(screen.queryByTestId('cue-wave')).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })

  it('warns that what it shows may change while VirtualDJ is open, since VirtualDJ writes its database on closing', async () => {
    setup(READ, true)
    await waitFor(() =>
      expect(screen.getByTestId('cues-virtualdj-waiting')).toHaveTextContent(
        i18n.t('editor.cues.virtualdj.waiting'),
      ),
    )
  })

  it('shows no warning while VirtualDJ is closed', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cues-read-only')).toBeInTheDocument())
    expect(screen.queryByTestId('cues-virtualdj-waiting')).not.toBeInTheDocument()
  })

  it('says the track has no cues in VirtualDJ rather than showing an empty list', async () => {
    setup({ ...READ, cues: [], loops: [] })
    await waitFor(() => expect(screen.getByTestId('cues-read-only-none')).toBeInTheDocument())
  })

  it('says it could not read the cues when VirtualDJ does not hold the track', async () => {
    setup(null)
    await waitFor(() =>
      expect(screen.getByTestId('cues-unreadable')).toHaveTextContent(
        i18n.t('editor.cues.virtualdj.unreadable'),
      ),
    )
  })
})

describe('the VirtualDJ cue texts', () => {
  it('talk about the cues the editor shows, not about lists', () => {
    for (const lng of ['es', 'en', 'de', 'fr', 'pt-BR', 'ja']) {
      const waiting = i18n.t('editor.cues.virtualdj.waiting', { lng })
      expect(waiting).not.toMatch(/list|lista|liste|リスト/i)
      expect(waiting).not.toMatch(/—/)
    }
  })
})
