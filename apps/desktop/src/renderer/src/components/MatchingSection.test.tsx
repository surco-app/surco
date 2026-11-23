// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { CollectionTrack } from '../../../shared/types'
import type { MatchingPartner } from '../lib/matchingPartners'
import { MatchingSection } from './MatchingSection'

afterEach(cleanup)

const TAKE: MatchingPartner = {
  contentId: '2',
  path: '/m/take.wav',
  title: 'Take Me Home',
  artist: 'Wonder Blue',
  key: '2A',
}

const COLLECTION: CollectionTrack[] = [
  { contentId: '1', path: '/m/let.wav', title: 'Let Yourself Go', artist: 'DLM' },
  { contentId: '2', path: '/m/take.wav', title: 'Take Me Home', artist: 'Wonder Blue' },
  { contentId: '3', path: '/m/acid.wav', title: 'Acid Groove', artist: 'Panic Mode' },
  { contentId: '4', path: '/m/eyes.wav', title: 'In My Eyes', artist: 'Milk Inc.' },
  { contentId: '5', path: null, title: 'Acid Stream', artist: 'Spotify' },
]

function setup(
  partners: MatchingPartner[],
  open = true,
  suggested: { track: CollectionTrack; times: number }[] = [],
) {
  const handlers = { onPick: vi.fn(), onRemove: vi.fn(), onToggle: vi.fn(), onAdd: vi.fn() }
  render(
    <MatchingSection
      partners={partners}
      open={open}
      selfId="1"
      collection={COLLECTION}
      suggested={suggested}
      {...handlers}
    />,
  )
  return handlers
}

const search = (text: string) => {
  fireEvent.change(screen.getByTestId('matching-search'), { target: { value: text } })
}

describe('MatchingSection', () => {
  it('lists the tracks the DJ paired with this one in rekordbox', () => {
    setup([TAKE])
    expect(screen.getByTestId('matching-partner')).toHaveTextContent('Take Me Home')
    expect(screen.getByTestId('matching-partner')).toHaveTextContent('Wonder Blue')
    expect(screen.getByTestId('matching-partner')).toHaveTextContent('2A')
  })

  it('jumps to a partner when the DJ picks it, to hear or edit the other half of the pair', () => {
    const { onPick } = setup([TAKE])
    fireEvent.click(screen.getByTestId('matching-partner'))
    expect(onPick).toHaveBeenCalledWith(TAKE)
  })

  it('unpairs a partner, the same way pressing the button again does in rekordbox', () => {
    const { onRemove, onPick } = setup([TAKE])
    fireEvent.click(screen.getByTestId('matching-partner-remove'))
    expect(onRemove).toHaveBeenCalledWith(TAKE)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('keeps the search in view even on a track with no partner yet, so pairing never costs a click to reveal it', () => {
    setup([])
    expect(screen.getByTestId('matching-search')).toBeInTheDocument()
    expect(screen.queryByTestId('matching-partner')).not.toBeInTheDocument()
  })

  it('finds a track of the collection by artist or title, ignoring accents and case', () => {
    setup([])
    search('panic acíd')
    expect(screen.getAllByTestId('matching-result').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Acid Groove'),
    ])
  })

  it('pairs the chosen track with this one', () => {
    const { onAdd } = setup([])
    search('eyes')
    fireEvent.click(screen.getByTestId('matching-result'))
    expect(onAdd).toHaveBeenCalledWith(COLLECTION[3])
    expect(screen.getByTestId('matching-search')).toHaveValue('')
    expect(screen.queryByTestId('matching-result')).not.toBeInTheDocument()
  })

  it('leaves out the track itself, its partners and streamed tracks, which cannot be paired', () => {
    setup([TAKE])
    search('e')
    const shown = screen.getAllByTestId('matching-result').map((r) => r.textContent)
    expect(shown.some((s) => s?.includes('Let Yourself Go'))).toBe(false)
    expect(shown.some((s) => s?.includes('Take Me Home'))).toBe(false)
    expect(shown.some((s) => s?.includes('Acid Stream'))).toBe(false)
    expect(shown.some((s) => s?.includes('Acid Groove'))).toBe(true)
  })

  it('clears the search with Escape without pairing anything', () => {
    const { onAdd } = setup([])
    search('acid')
    fireEvent.keyDown(screen.getByTestId('matching-search'), { key: 'Escape' })
    expect(screen.getByTestId('matching-search')).toHaveValue('')
    expect(screen.queryByTestId('matching-result')).not.toBeInTheDocument()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('keeps Escape inside the field only while there is text to clear, so an empty field never swallows the key', () => {
    setup([])
    const onKeyDown = vi.fn()
    document.addEventListener('keydown', onKeyDown)
    fireEvent.keyDown(screen.getByTestId('matching-search'), { key: 'Escape' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    search('acid')
    fireEvent.keyDown(screen.getByTestId('matching-search'), { key: 'Escape' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', onKeyDown)
  })

  it('drops the results when focus leaves the search, so a half-typed query never hangs open under the section', () => {
    setup([])
    search('acid')
    fireEvent.blur(screen.getByTestId('matching-search'))
    expect(screen.queryByTestId('matching-result')).not.toBeInTheDocument()
  })

  it('does not take the focus when a track opens, so the editor shortcuts keep working', () => {
    setup([])
    expect(screen.getByTestId('matching-search')).not.toHaveFocus()
  })

  it('lists the tracks the DJ often plays with this one and pairs one in a click', () => {
    const { onAdd } = setup([], true, [
      { track: COLLECTION[2], times: 17 },
      { track: COLLECTION[3], times: 13 },
    ])
    const rows = screen.getAllByTestId('matching-suggested')
    expect(rows[0]).toHaveTextContent('Acid Groove')
    expect(rows[0]).toHaveTextContent('17')
    fireEvent.click(screen.getAllByTestId('matching-suggested-match')[1])
    expect(onAdd).toHaveBeenCalledWith(COLLECTION[3])
  })

  it('shows no suggestion heading when there is nothing to suggest', () => {
    setup([])
    expect(screen.queryByTestId('matching-suggested')).not.toBeInTheDocument()
  })
})
