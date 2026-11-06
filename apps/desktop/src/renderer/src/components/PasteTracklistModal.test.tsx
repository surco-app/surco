// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { CollectionTrack, SourceNode } from '../../../shared/types'
import i18n from '../i18n'
import { installApi } from '../test/api'
import { PasteTracklistModal } from './PasteTracklistModal'

beforeAll(() => i18n.changeLanguage('es'))
afterEach(cleanup)

const SET1 = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'docs',
    'superpowers',
    'specs',
    '2026-11-06-pegar-tracklist',
    'set1-youtube.txt',
  ),
  'utf8',
)

const track = (artist: string, title: string): CollectionTrack => ({
  contentId: `${artist} - ${title}`,
  path: `/music/${title}.wav`,
  title,
  artist,
})
const SMALL: CollectionTrack[] = [
  track('Sergi M, Solar System', 'Because Of You'),
  track('Jessy', 'Head Over Heels (Extended)'),
  track('3 Ways', 'Real Love (Extended Version)'),
  track('3 Ways', 'Real Love'),
  track('Stephan K', 'Action (Poky Mix)'),
  track('Jessy', 'Silent Tears (Extended Mix)'),
]
const NODE: SourceNode = { id: 'todo', name: 'Todo', kind: 'playlist', count: 3 }
const FOLDER: SourceNode = { id: 'sets', name: 'Sets', kind: 'folder', count: 1 }

function setup(over: { create?: boolean; collection?: () => Promise<CollectionTrack[]> } = {}) {
  installApi({
    loadRekordboxCollection: vi
      .fn<Api['loadRekordboxCollection']>()
      .mockImplementation(over.collection ?? (async () => SMALL)),
  })
  const onAdd = vi.fn()
  const onClose = vi.fn()
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PasteTracklistModal
        program="rekordbox"
        node={over.create ? FOLDER : NODE}
        create={over.create ?? false}
        onAdd={onAdd}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { onAdd, onClose }
}

const paste = (text: string) =>
  fireEvent.change(screen.getByTestId('paste-tracklist-text'), { target: { value: text } })
const search = () => fireEvent.click(screen.getByTestId('paste-tracklist-search'))
const review = async () => {
  search()
  await waitFor(() => expect(screen.getByTestId('paste-tracklist-summary')).toBeInTheDocument())
}

describe('PasteTracklistModal paste step', () => {
  it('counts the tracks and gaps as the text is pasted', () => {
    setup()
    paste(SET1)
    expect(screen.getByTestId('paste-tracklist-count')).toHaveTextContent('19 pistas, 2 huecos')
    expect(screen.getByTestId('paste-tracklist-search')).toBeEnabled()
  })

  it('keeps Search off when nothing pasted reads as a track', () => {
    setup()
    paste('https://www.youtube.com/watch?v=3TIb5Yin3Fw\nhola')
    expect(screen.getByTestId('paste-tracklist-count')).toHaveTextContent('0 pistas')
    expect(screen.getByTestId('paste-tracklist-search')).toBeDisabled()
  })

  it('asks for a name on a folder and keeps Search off until it has one', () => {
    setup({ create: true })
    paste(SET1)
    expect(screen.getByTestId('paste-tracklist-search')).toBeDisabled()
    fireEvent.change(screen.getByTestId('paste-tracklist-name'), { target: { value: 'Mi set' } })
    expect(screen.getByTestId('paste-tracklist-search')).toBeEnabled()
  })

  it('has no name field on a playlist', () => {
    setup()
    expect(screen.queryByTestId('paste-tracklist-name')).toBeNull()
  })
})

describe('PasteTracklistModal review step', () => {
  it('sums up the levels and leaves out the lines the collection lacks', async () => {
    setup()
    paste(SET1)
    await review()
    const summary = screen.getByTestId('paste-tracklist-summary')
    expect(summary).toHaveTextContent('2 encontradas')
    expect(summary).toHaveTextContent('2 dudosas')
    expect(summary).toHaveTextContent('1 parecida')
    expect(summary).toHaveTextContent('14 no están en la colección y se ignoran')
    expect(screen.getAllByTestId(/^paste-tracklist-row-\d+$/)).toHaveLength(5)
    expect(screen.getByTestId('paste-tracklist-add')).toHaveTextContent('Añadir 4 pistas')
  })

  it('leaves a similar track out until the user takes it, and counts it then', async () => {
    setup()
    paste(SET1)
    await review()
    const similar = screen.getByTestId('paste-tracklist-row-4')
    expect(similar).toHaveTextContent('Action (Poky Mix)')
    expect(screen.getByTestId('paste-tracklist-exclude-4')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('paste-tracklist-accept-4'))
    expect(screen.getByTestId('paste-tracklist-add')).toHaveTextContent('Añadir 5 pistas')
  })

  it('hands over the picked candidate, in set order, as playlist refs', async () => {
    const { onAdd } = setup()
    paste(SET1)
    await review()
    fireEvent.click(screen.getByTestId('paste-tracklist-pick-2-1'))
    fireEvent.click(screen.getByTestId('paste-tracklist-add'))
    expect(onAdd).toHaveBeenCalledWith(
      [
        {
          contentId: 'Sergi M, Solar System - Because Of You',
          paths: ['/music/Because Of You.wav'],
        },
        {
          contentId: 'Jessy - Head Over Heels (Extended)',
          paths: ['/music/Head Over Heels (Extended).wav'],
        },
        { contentId: '3 Ways - Real Love', paths: ['/music/Real Love.wav'] },
        {
          contentId: 'Jessy - Silent Tears (Extended Mix)',
          paths: ['/music/Silent Tears (Extended Mix).wav'],
        },
      ],
      null,
    )
  })

  it('hands over the typed name when creating a playlist', async () => {
    const { onAdd } = setup({ create: true })
    paste(SET1)
    fireEvent.change(screen.getByTestId('paste-tracklist-name'), { target: { value: 'Mi set' } })
    await review()
    fireEvent.click(screen.getByTestId('paste-tracklist-add'))
    expect(onAdd).toHaveBeenCalledWith(expect.any(Array), 'Mi set')
  })

  it('shows an empty review with Add off when the collection cannot be read', async () => {
    setup({ collection: async () => Promise.reject(new Error('locked')) })
    paste(SET1)
    await review()
    expect(screen.getByTestId('paste-tracklist-summary')).toHaveTextContent('0 encontradas')
    expect(screen.getByTestId('paste-tracklist-add')).toBeDisabled()
  })

  it('goes back to the pasted text untouched', async () => {
    setup()
    paste(SET1)
    await review()
    fireEvent.click(screen.getByTestId('paste-tracklist-back'))
    expect(screen.getByTestId('paste-tracklist-text')).toHaveValue(SET1)
  })
})
