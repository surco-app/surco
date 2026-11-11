// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { HOT_KINDS } from '../../../shared/cueRules'
import type { TrackCues } from '../../../shared/types'
import { resetEditorSections } from '../hooks/useEditorSections'
import i18n from '../i18n'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { djReads, installApi, type ProgramReads } from '../test/api'
import { hoverTooltip } from '../test/tooltip'
import { CuesSection } from './CuesSection'

afterEach(cleanup)
afterEach(resetCueSession)
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

const ready = () => waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
const markAt = (ms: number) => {
  fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: ms / 1000 })
  fireEvent.mouseUp(window, { clientX: ms / 1000 })
  fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Enter' })
}

describe('CuesSection on a VirtualDJ track', () => {
  it('opens the normal cue editor on the wave and saves the marks to VirtualDJ under the track’s VirtualDJ id', async () => {
    const { save } = setup()
    await ready()
    expect(screen.queryByTestId('cues-read-only')).toBeNull()
    expect(screen.getByTestId('cues-save')).toHaveAccessibleName(
      i18n.t('editor.cues.virtualdj.save'),
    )
    markAt(128000)
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeEnabled())
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0][0]).toMatchObject({
      contentId: ID,
      path: '/Music/v.mp3',
      label: 'V',
      fingerprint: 'f0',
    })
  })

  it('says while VirtualDJ is open that the changes will be saved once it is closed, and still lets them be saved', async () => {
    const { save } = setup(READ, true)
    await ready()
    markAt(128000)
    expect(await screen.findByTestId('cues-virtualdj-waiting')).toHaveTextContent(
      i18n.t('editor.cues.virtualdj.waiting'),
    )
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeEnabled())
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(save).toHaveBeenCalled())
  })

  it('shows no warning while VirtualDJ is closed', async () => {
    setup()
    await ready()
    markAt(128000)
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeEnabled())
    expect(screen.queryByTestId('cues-virtualdj-waiting')).not.toBeInTheDocument()
  })

  it('keeps VirtualDJ’s beat grid as VirtualDJ has it and says why, since Surco does not write the grid there', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByTestId('section-maximize'))
    await waitFor(() => expect(screen.getByTestId('cues-grid')).toBeInTheDocument())
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('aria-disabled', 'true')
    expect(hoverTooltip(screen.getByTestId('cues-grid'))).toEqual(
      i18n.t('editor.cues.grid.virtualdj'),
    )
  })

  it('offers Auto mark on a track VirtualDJ has a beat grid for', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-auto-mark')).toBeInTheDocument()
  })

  it('says the CALLs stay in Surco, since VirtualDJ keeps only hot cues', async () => {
    setup()
    await ready()
    markAt(128000)
    expect(await screen.findByTestId('cues-virtualdj-calls')).toHaveTextContent(
      i18n.t('editor.cues.virtualdj.calls'),
    )
  })

  it('offers no saving on a track VirtualDJ has not analysed, and says so', async () => {
    setup({ ...READ, analysed: false, grid: [] })
    expect(await screen.findByTestId('cues-unanalysed')).toHaveTextContent(
      i18n.t('editor.cues.virtualdj.unanalysed'),
    )
    expect(screen.queryByTestId('cues-save')).toBeNull()
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
