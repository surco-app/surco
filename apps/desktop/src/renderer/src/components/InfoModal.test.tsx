// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata, TrackProperties } from '../../../shared/types'
import i18n from '../i18n'
import { createQueryClient } from '../lib/queryClient'
import type { TrackItem } from '../types'
import { InfoModal } from './InfoModal'

afterEach(cleanup)

const facts: TrackProperties = {
  codec: 'pcm_s16le',
  container: 'wav',
  sampleRateHz: 44100,
  bitDepth: 16,
  channels: 2,
  bitrateKbps: 1411,
  sizeBytes: 40_000_000,
  createdMs: null,
  modifiedMs: null,
  tagFormats: ['ID3v2.4'],
}

const track: TrackItem = {
  id: 'a',
  inputPath: '/music/Pray.wav',
  fileName: 'Pray',
  listLabel: 'Pray',
  query: '',
  status: 'idle',
  meta: { title: 'Pray' } as TrackMetadata,
}

function renderModal(properties: () => Promise<TrackProperties | null>): { onClose: () => void } {
  ;(window as unknown as { api: unknown }).api = { properties: vi.fn(properties) }
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={createQueryClient()}>
      <InfoModal track={track} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

// The file facts are reference material a DJ consults now and then, so besides the
// editor's Properties section they sit one keystroke away (⌘I, like Finder's Get Info),
// whatever the editor layout.
describe('InfoModal', () => {
  it('shows the track facts under a title naming the window', async () => {
    renderModal(() => Promise.resolve(facts))
    expect(await screen.findByTestId('properties-readout')).toBeInTheDocument()
    expect(screen.getByTestId('property-kind')).toHaveTextContent('WAV')
    expect(screen.getByTestId('info-modal')).toHaveAccessibleName(i18n.t('info.title'))
  })

  it('holds the table shape while the probe runs', () => {
    renderModal(() => new Promise(() => {}))
    expect(screen.getByTestId('properties-skeleton')).toBeInTheDocument()
  })

  it('says the facts are unavailable when the probe cannot read the file', async () => {
    renderModal(() => Promise.resolve(null))
    expect(await screen.findByText(i18n.t('editor.propertiesUnavailable'))).toBeInTheDocument()
  })

  // The window exists to surface the facts ffprobe reads off the source, formatted
  // for a human (kHz, Bit, kbps, MB), not raw, so a DJ can vet a rip.
  it('formats the probed audio facts for a human', async () => {
    renderModal(() => Promise.resolve(facts))
    expect(await screen.findByTestId('property-sampleRate')).toHaveTextContent('44.1 kHz')
    expect(screen.getByTestId('property-bitDepth')).toHaveTextContent(
      i18n.t('editor.propBitDepthValue', { bits: 16 }),
    )
    expect(screen.getByTestId('property-channelMode')).toHaveTextContent(
      i18n.t('editor.channelModeStereo'),
    )
    expect(screen.getByTestId('property-bitrate')).toHaveTextContent('1411 kbps')
  })

  // A lossy source has no fixed bit depth and an untagged file sniffs no formats: the
  // rows drop out rather than print "0 bits" or an empty line.
  it('omits the rows the probe could not read', async () => {
    renderModal(() => Promise.resolve({ ...facts, bitDepth: null, tagFormats: [] }))
    await screen.findByTestId('property-sampleRate')
    expect(screen.queryByTestId('property-bitDepth')).not.toBeInTheDocument()
    expect(screen.queryByTestId('property-tagFormats')).not.toBeInTheDocument()
  })

  it('closes from its close button', () => {
    const { onClose } = renderModal(() => Promise.resolve(facts))
    fireEvent.click(screen.getByTestId('info-close'))
    expect(onClose).toHaveBeenCalled()
  })
})
