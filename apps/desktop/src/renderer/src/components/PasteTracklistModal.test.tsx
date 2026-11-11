// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CollectionTrack, SourceNode } from '../../../shared/types'
import i18n from '../i18n'
import { djReads, installApi, type ProgramReads } from '../test/api'
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
    dj: djReads({
      rekordbox: {
        collection: vi
          .fn<ProgramReads['collection']>()
          .mockImplementation(over.collection ?? (async () => SMALL)),
      },
    }),
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
    expect(screen.getByTestId('paste-tracklist-hint')).toHaveTextContent(
      /^14 líneas no están en la colección y se ignoran\.$/,
    )
    expect(screen.getByTestId('paste-tracklist-rules')).toHaveTextContent('Dudosa')
    expect(screen.getAllByTestId(/^paste-tracklist-row-\d+$/)).toHaveLength(5)
    expect(screen.getByTestId('paste-tracklist-add')).toHaveTextContent('Añadir 4 pistas')
  })

  it('names the count only on the Add button, so the footer does not repeat it', async () => {
    setup()
    paste(SET1)
    await review()
    expect(screen.getByTestId('paste-tracklist-add')).toHaveTextContent('Añadir 4 pistas')
    expect(screen.queryByText(/Se añadirán/)).toBeNull()
  })

  it('leaves a similar track out until the user takes it, and counts it then', async () => {
    setup()
    paste(SET1)
    await review()
    const similar = screen.getByTestId('paste-tracklist-row-4')
    expect(similar).toHaveTextContent('Action (Poky Mix)')
    expect(screen.getByTestId('paste-tracklist-include-4')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('paste-tracklist-include-4'))
    expect(screen.getByTestId('paste-tracklist-include-4')).toBeChecked()
    expect(screen.getByTestId('paste-tracklist-add')).toHaveTextContent('Añadir 5 pistas')
  })

  it('marks the mix that differs without amber, so the amber dot alone says which rows to check', async () => {
    setup()
    paste(SET1)
    await review()
    const row = screen
      .getAllByTestId(/^paste-tracklist-row-\d+$/)
      .find((r) => r.textContent?.includes('Head over heels (Radio Edit)'))
    const mix = within(row as HTMLElement).getByTestId('paste-tracklist-mix-diff')
    expect(mix).toHaveTextContent('(Extended)')
    expect(mix.className).not.toMatch(/text-warn/)
  })

  it('lets the user leave a found track out too, the one control every row shares', async () => {
    setup()
    paste(SET1)
    await review()
    expect(screen.getByTestId('paste-tracklist-include-0')).toBeChecked()
    fireEvent.click(screen.getByTestId('paste-tracklist-include-0'))
    expect(screen.getByTestId('paste-tracklist-add')).toHaveTextContent('Añadir 3 pistas')
  })

  it('narrows the list to one level from its count, so 13 similar can be checked without wading through 107', async () => {
    setup()
    paste(SET1)
    await review()
    fireEvent.click(screen.getByTestId('paste-tracklist-filter-doubtful'))
    expect(screen.getByTestId('paste-tracklist-filter-doubtful')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getAllByTestId(/^paste-tracklist-row-\d+$/)).toHaveLength(2)
    fireEvent.click(screen.getByTestId('paste-tracklist-include-2'))
    expect(screen.getByTestId('paste-tracklist-add')).toHaveTextContent('Añadir 3 pistas')
    fireEvent.click(screen.getByTestId('paste-tracklist-filter-all'))
    expect(screen.getAllByTestId(/^paste-tracklist-row-\d+$/)).toHaveLength(5)
    expect(screen.getByTestId('paste-tracklist-filter-all')).toHaveTextContent('5 en total')
  })

  it('shows the time column when the pasted set has times, so each row says where it sits in the set', async () => {
    setup()
    paste(SET1)
    await review()
    expect(screen.getByTestId('paste-tracklist-at-0')).toBeInTheDocument()
  })

  it('drops the time column when no line has a time, so the rows do not start with an empty gap', async () => {
    setup()
    paste('Jessy - Silent Tears (Extended Mix)\nStephan K - Action (Poky Mix)')
    await review()
    expect(screen.getByTestId('paste-tracklist-row-0')).toBeInTheDocument()
    expect(screen.queryByTestId('paste-tracklist-at-0')).toBeNull()
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
    expect(screen.getByTestId('paste-tracklist-hint')).toHaveTextContent(
      'No se pudo leer la colección',
    )
    expect(screen.getByTestId('paste-tracklist-add')).toBeDisabled()
  })

  it('keeps the pasted text when the user clicks outside the modal', async () => {
    const { onClose } = setup()
    paste(SET1)
    fireEvent.click(screen.getByTestId('paste-tracklist-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
    await review()
    fireEvent.click(screen.getByTestId('paste-tracklist-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('paste-tracklist-summary')).toBeInTheDocument()
  })

  it('still closes from the backdrop while nothing is pasted', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByTestId('paste-tracklist-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes from the X at either step, pasted text or not, so the review is never a trap', async () => {
    const { onClose } = setup()
    paste(SET1)
    fireEvent.click(screen.getByTestId('paste-tracklist-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    await review()
    fireEvent.click(screen.getByTestId('paste-tracklist-close'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('goes back to the pasted text untouched', async () => {
    setup()
    paste(SET1)
    await review()
    fireEvent.click(screen.getByTestId('paste-tracklist-back'))
    expect(screen.getByTestId('paste-tracklist-text')).toHaveValue(SET1)
  })
})
