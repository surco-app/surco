// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { RekordboxPlaylistTarget, SourceNode } from '../../../shared/types'
import { playlistOptions } from '../lib/rekordboxPlaylists'
import { PlaylistsBulkField, PlaylistsField } from './PlaylistsField'
import { EngineIcon, RekordboxIcon, TraktorIcon } from './SourceIcons'

afterEach(cleanup)

const playlist = (id: string, name: string, count = 10): SourceNode => ({
  id,
  name,
  kind: 'playlist',
  count,
})

const folder = (id: string, name: string, children: SourceNode[]): SourceNode => ({
  id,
  name,
  kind: 'folder',
  count: children.length,
  children,
})

const BOLOS = Array.from({ length: 20 }, (_, i) => playlist(`b${i + 1}`, `Bolo ${i + 1}`))

const TREE: SourceNode[] = [
  folder('bolos', 'BOLOS', BOLOS),
  folder('can', 'CANTADITAS', [
    folder('can90', '90s', [playlist('c90t', 'Todas', 41), playlist('c90l', 'Lentas')]),
    folder('can2k', '2ks', [playlist('c2kt', 'Todas')]),
  ]),
  folder('bases', 'BASES', [playlist('bt', 'Todas')]),
  playlist('house', 'House', 32),
  playlist('mash', 'Mashups', 9),
]
const OPTIONS = playlistOptions(TREE)

const target = (id: string): RekordboxPlaylistTarget => {
  const o = OPTIONS.find((x) => x.id === id)
  if (!o) throw new Error(id)
  return { id: o.id, name: o.name }
}

const SEVEN = ['b1', 'b2', 'b3', 'b4', 'b5', 'c90t', 'house'].map(target)

function Harness({ initial = SEVEN, spy = vi.fn() }) {
  const [value, setValue] = useState(initial)
  return (
    <PlaylistsField
      label="rekordbox playlists"
      tree={TREE}
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        spy(next)
        setValue(next)
      }}
    />
  )
}

const summary = () => screen.getByTestId('playlists-summary')
const search = () => screen.getByTestId('playlists-search')
const open = () => fireEvent.click(summary())
const visiblePlaylists = () =>
  screen.queryAllByTestId(/^playlists-check-/).map((el) => el.getAttribute('data-testid'))

describe('PlaylistsField for Traktor and Engine DJ', () => {
  it('is named by its label alone, which already carries the program', () => {
    render(
      <PlaylistsField
        library="traktor"
        label="Traktor playlists"
        tree={TREE}
        options={OPTIONS}
        value={[]}
        onChange={vi.fn()}
      />,
    )
    const field = screen.getByTestId('traktor-playlists-field')
    expect(within(field).getByTestId('playlists-summary')).toHaveAccessibleName('Traktor playlists')
    fireEvent.click(within(field).getByTestId('playlists-summary'))
    expect(screen.getByTestId('playlists-popover')).toHaveAccessibleName('Traktor playlists')
  })

  it('shows only the program beside the field, so the label fits one line, and keeps the full name for screen readers', () => {
    render(
      <PlaylistsField
        library="engine"
        label="Engine DJ playlists"
        tree={TREE}
        options={OPTIONS}
        value={[]}
        onChange={vi.fn()}
      />,
    )
    const label = screen.getByTestId('playlists-field-label')
    expect(label).toHaveTextContent(/^Engine DJ/)
    expect(within(label).getByText('Engine DJ', { exact: true })).toBeVisible()
    expect(screen.getByTestId('playlists-summary')).toHaveAccessibleName('Engine DJ playlists')
  })

  it('stays in place but disabled until the Traktor collection is confirmed, and says where', () => {
    render(
      <PlaylistsField
        library="traktor"
        disabled="unconfirmed"
        label="Playlists"
        tree={TREE}
        options={OPTIONS}
        value={[]}
        onChange={vi.fn()}
      />,
    )
    expect(summary()).toBeDisabled()
    expect(summary()).toHaveTextContent('Choose the collection in Settings')
    fireEvent.click(summary())
    expect(screen.queryByTestId('playlists-popover')).toBeNull()
  })
})

describe('PlaylistsField closed', () => {
  it('fits nine playlists on one line by counting them and naming each top folder once', () => {
    render(<Harness />)
    expect(screen.getByTestId('playlists-count')).toHaveTextContent('In 7 playlists')
    expect(screen.getByTestId('playlists-where').textContent).toBe('BOLOS (5) · CANTADITAS · House')
    expect(screen.queryByTestId('playlists-popover')).toBeNull()
  })

  it('reads the count and where to a screen reader, since the label alone only names the field', () => {
    render(<Harness />)
    expect(summary()).toHaveAccessibleName('rekordbox playlists')
    expect(summary()).toHaveAccessibleDescription('In 7 playlists BOLOS (5) · CANTADITAS · House')
    cleanup()
    render(<Harness initial={[]} />)
    expect(summary()).toHaveAccessibleDescription('Add to a playlist')
  })

  it('says one playlist in the singular', () => {
    render(<Harness initial={[target('house')]} />)
    expect(screen.getByTestId('playlists-count')).toHaveTextContent('In 1 playlist')
    expect(screen.getByTestId('playlists-count')).not.toHaveTextContent('playlists')
  })

  it('invites to add one when the track is in none', () => {
    render(<Harness initial={[]} />)
    expect(summary()).toHaveTextContent('Add to a playlist')
    expect(screen.queryByTestId('playlists-count')).toBeNull()
  })

  it('counts a playlist still to be created and marks it pending, since rekordbox does not have it yet', () => {
    render(<Harness initial={[target('house'), { name: 'Cierre' }]} />)
    expect(screen.getByTestId('playlists-count')).toHaveTextContent('In 2 playlists')
    expect(screen.getByTestId('playlists-where').textContent).toBe('House · Cierre')
    expect(screen.getByTestId('playlists-pending-Cierre')).toHaveAttribute('data-pending', 'true')
  })
})

describe('PlaylistsField open', () => {
  it('shows the rekordbox tree with the folders holding the track open and the rest closed', () => {
    render(<Harness />)
    open()
    expect(screen.getByTestId('playlists-popover')).toBeInTheDocument()
    expect(search()).toHaveFocus()
    expect(screen.getByTestId('playlists-folder-bolos')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('playlists-folder-can')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('playlists-folder-can90')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('playlists-folder-can2k')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('playlists-folder-bases')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('playlists-check-bt')).toBeNull()
  })

  it('tells how many playlists of each folder hold the track, counting the ones in subfolders', () => {
    render(<Harness />)
    open()
    expect(screen.getByTestId('playlists-folder-count-bolos').textContent).toBe('5 of 20')
    expect(screen.getByTestId('playlists-folder-count-can').textContent).toBe('1 of 3')
    expect(screen.getByTestId('playlists-folder-count-bases').textContent).toBe('1')
  })

  it('shows each playlist ticked when the track is in it, with its track count', () => {
    render(<Harness />)
    open()
    expect(screen.getByTestId('playlists-check-b1')).toBeChecked()
    expect(screen.getByTestId('playlists-check-b6')).not.toBeChecked()
    expect(screen.getByTestId('playlists-row-c90t')).toHaveTextContent('41')
  })

  it('adds the track to a playlist when ticked, the same way picking a suggestion did', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    open()
    fireEvent.click(screen.getByTestId('playlists-check-b6'))
    expect(spy).toHaveBeenLastCalledWith([...SEVEN, target('b6')])
    expect(screen.getByTestId('playlists-check-b6')).toBeChecked()
  })

  it('takes the track out of a playlist when unticked, the same way removing a chip did', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    open()
    fireEvent.click(screen.getByTestId('playlists-check-b1'))
    expect(spy).toHaveBeenLastCalledWith(SEVEN.slice(1))
  })

  it('gives folders no checkbox, so one click never puts the track in a whole folder of playlists', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    open()
    const bases = screen.getByTestId('playlists-folder-bases')
    expect(bases).not.toHaveAttribute('role', 'checkbox')
    expect(within(bases).queryByRole('checkbox', { hidden: true })).toBeNull()
    fireEvent.click(bases)
    expect(spy).not.toHaveBeenCalled()
    expect(bases).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('playlists-check-bt')).toBeInTheDocument()
  })

  it('lets a playlist still to be created be unticked, as its chip could be removed', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} initial={[{ name: 'Cierre' }]} />)
    open()
    fireEvent.click(screen.getByTestId('playlists-check-new:Cierre'))
    expect(spy).toHaveBeenLastCalledWith([])
  })

  it('closes on a click outside, so it does not hang over the fields below', () => {
    render(<Harness />)
    open()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('playlists-popover')).toBeNull()
  })
})

describe('PlaylistsField search', () => {
  it('matches every word against the folder path, opening the folders above each hit', () => {
    render(<Harness />)
    open()
    fireEvent.change(search(), { target: { value: '90 todas' } })
    expect(visiblePlaylists()).toEqual(['playlists-check-c90t'])
    expect(screen.getByTestId('playlists-folder-can')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('playlists-folder-can90')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByTestId('playlists-folder-bolos')).toBeNull()
  })

  it('offers to create a playlist no name matches exactly, and adds it pending', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    open()
    fireEvent.change(search(), { target: { value: 'House' } })
    expect(screen.queryByTestId('playlists-create')).toBeNull()
    fireEvent.change(search(), { target: { value: 'Cierre' } })
    fireEvent.click(screen.getByTestId('playlists-create'))
    expect(spy).toHaveBeenLastCalledWith([...SEVEN, { name: 'Cierre' }])
    expect(search()).toHaveValue('')
    expect(screen.getByTestId('playlists-pending-Cierre')).toBeInTheDocument()
  })

  it('toggles the one matching playlist with Enter', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    open()
    fireEvent.change(search(), { target: { value: 'mash' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(spy).toHaveBeenLastCalledWith([...SEVEN, target('mash')])
  })

  it('creates with Enter when only the create row is offered', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    open()
    fireEvent.change(search(), { target: { value: 'Cierre' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(spy).toHaveBeenLastCalledWith([...SEVEN, { name: 'Cierre' }])
  })

  it('does nothing with Enter on an empty box, even with a single playlist on screen, so no rekordbox write is queued by accident', () => {
    const spy = vi.fn()
    render(
      <PlaylistsField
        label="Playlists"
        tree={[playlist('house', 'House')]}
        options={playlistOptions([playlist('house', 'House')])}
        value={[]}
        onChange={spy}
      />,
    )
    open()
    expect(visiblePlaylists()).toEqual(['playlists-check-house'])
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing with Enter while several playlists match', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    open()
    fireEvent.change(search(), { target: { value: 'todas' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('PlaylistsField keyboard', () => {
  it('closes with Escape, gives the focus back to the field and keeps the key from the editor', () => {
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    render(<Harness />)
    open()
    fireEvent.keyDown(search(), { key: 'Escape' })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
    expect(screen.queryByTestId('playlists-popover')).toBeNull()
    expect(summary()).toHaveFocus()
  })

  it('walks the visible rows with the arrows and toggles the focused playlist with Space', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    open()
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    expect(screen.getByTestId('playlists-folder-bolos')).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(screen.getByTestId('playlists-check-b1')).toHaveFocus()
    fireEvent.keyDown(document.activeElement as Element, { key: ' ' })
    expect(spy).toHaveBeenLastCalledWith(SEVEN.slice(1))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
    expect(search()).toHaveFocus()
  })

  it('closes and opens a folder with the left and right arrows', () => {
    render(<Harness />)
    open()
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    const bolos = screen.getByTestId('playlists-folder-bolos')
    fireEvent.keyDown(bolos, { key: 'ArrowLeft' })
    expect(bolos).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('playlists-check-b1')).toBeNull()
    fireEvent.keyDown(bolos, { key: 'ArrowRight' })
    expect(bolos).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('PlaylistsField on a Serato crate that holds subcrates', () => {
  const CRATES: SourceNode[] = [
    {
      ...playlist('House', 'House', 12),
      children: [playlist('House%%Deep', 'Deep', 4), playlist('House%%Tech', 'Tech', 3)],
    },
    playlist('Friday', 'Friday', 2),
  ]
  const crateOptions = playlistOptions(CRATES)
  const crate = (id: string): RekordboxPlaylistTarget => {
    const o = crateOptions.find((x) => x.id === id)
    if (!o) throw new Error(id)
    return { id: o.id, name: o.name }
  }

  function Crates({
    initial,
    spy = vi.fn(),
  }: {
    initial: RekordboxPlaylistTarget[]
    spy?: (next: RekordboxPlaylistTarget[]) => void
  }) {
    const [value, setValue] = useState(initial)
    return (
      <PlaylistsField
        library="serato"
        label="Serato crates"
        tree={CRATES}
        options={crateOptions}
        value={value}
        onChange={(next) => {
          spy(next)
          setValue(next)
        }}
      />
    )
  }

  it('ticks the parent crate itself, since Serato keeps tracks in it', () => {
    const spy = vi.fn()
    render(<Crates initial={[]} spy={spy} />)
    open()
    expect(screen.getByTestId('playlists-row-House')).toHaveTextContent('12')
    fireEvent.click(screen.getByTestId('playlists-check-House'))
    expect(spy).toHaveBeenLastCalledWith([crate('House')])
  })

  it('shows the parent crate ticked when the track is in it, with its subcrates folded away', () => {
    render(<Crates initial={[crate('House')]} />)
    open()
    expect(screen.getByTestId('playlists-check-House')).toBeChecked()
    expect(screen.getByTestId('playlists-expand-House')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('playlists-check-House%%Deep')).toBeNull()
  })

  it('opens the subcrates from the chevron without ticking the parent', () => {
    const spy = vi.fn()
    render(<Crates initial={[]} spy={spy} />)
    open()
    fireEvent.click(screen.getByTestId('playlists-expand-House'))
    expect(screen.getByTestId('playlists-expand-House')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('playlists-check-House%%Deep')).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })

  it('opens the parent crate when the track is in one of its subcrates', () => {
    render(<Crates initial={[crate('House%%Deep')]} />)
    open()
    expect(screen.getByTestId('playlists-check-House%%Deep')).toBeChecked()
  })

  it('opens and closes the subcrates with the right and left arrows', () => {
    render(<Crates initial={[]} />)
    open()
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    const house = screen.getByTestId('playlists-check-House')
    fireEvent.keyDown(house, { key: 'ArrowRight' })
    expect(screen.getByTestId('playlists-check-House%%Tech')).toBeInTheDocument()
    fireEvent.keyDown(house, { key: 'ArrowLeft' })
    expect(screen.queryByTestId('playlists-check-House%%Tech')).toBeNull()
  })

  it('finds a subcrate by name with its parent crate above it', () => {
    render(<Crates initial={[]} />)
    open()
    fireEvent.change(search(), { target: { value: 'tech' } })
    expect(visiblePlaylists()).toEqual(['playlists-check-House', 'playlists-check-House%%Tech'])
  })

  it('ticks the parent crate when its name is clicked, keeping the name on its checkbox, and leaves it folded', () => {
    const spy = vi.fn()
    render(<Crates initial={[]} spy={spy} />)
    open()
    fireEvent.click(within(screen.getByTestId('playlists-row-House')).getByText('House'))
    expect(spy).toHaveBeenLastCalledWith([crate('House')])
    expect(screen.getByRole('checkbox', { name: 'House 12' })).toBeChecked()
    expect(screen.getByTestId('playlists-expand-House')).toHaveAttribute('aria-expanded', 'false')
  })

  it('ticks the one subcrate a search finds with Enter, since its parent only shows where it lives', () => {
    const spy = vi.fn()
    render(<Crates initial={[]} spy={spy} />)
    open()
    fireEvent.change(search(), { target: { value: 'tech' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(spy).toHaveBeenLastCalledWith([crate('House%%Tech')])
  })

  it('names the parent crate once in the summary, counting the subcrates chosen in it', () => {
    render(<Crates initial={[crate('House'), crate('House%%Deep'), crate('Friday')]} />)
    expect(screen.getByTestId('playlists-where').textContent).toBe('House (2) · Friday')
  })
})

describe('PlaylistsBulkField', () => {
  const states = [
    { target: target('house'), state: 'all' as const },
    { target: target('c90t'), state: 'some' as const },
  ]
  const renderBulk = (onToggle = vi.fn()) => {
    render(
      <PlaylistsBulkField
        label="Playlists"
        tree={TREE}
        options={OPTIONS}
        states={states}
        onToggle={onToggle}
      />,
    )
    open()
    return onToggle
  }

  it('shows a playlist only some of the tracks hold as half ticked', () => {
    renderBulk()
    expect(screen.getByTestId('playlists-check-c90t')).toBePartiallyChecked()
    expect(screen.getByTestId('playlists-check-house')).toBeChecked()
    expect(screen.getByTestId('playlists-check-mash')).not.toBeChecked()
  })

  it('completes a half ticked playlist for every track on click', () => {
    const onToggle = renderBulk()
    fireEvent.click(screen.getByTestId('playlists-check-c90t'))
    expect(onToggle).toHaveBeenCalledWith(target('c90t'), true)
  })

  it('takes a ticked playlist off every track and adds an unticked one to all', () => {
    const onToggle = renderBulk()
    fireEvent.click(screen.getByTestId('playlists-check-house'))
    expect(onToggle).toHaveBeenCalledWith(target('house'), false)
    fireEvent.click(screen.getByTestId('playlists-check-mash'))
    expect(onToggle).toHaveBeenCalledWith(target('mash'), true)
  })
})

describe('the program mark', () => {
  const maskOf = (root: Element) => root.querySelector('label svg mask')?.innerHTML
  it.each([
    ['rekordbox', 'playlists-field', RekordboxIcon],
    ['traktor', 'traktor-playlists-field', TraktorIcon],
    ['engine', 'engine-playlists-field', EngineIcon],
  ] as const)(
    'marks the %s field with that program’s own logo, so two programs’ fields never look alike',
    (library, testId, Icon) => {
      const { container } = render(<Icon size={12} />)
      const own = container.querySelector('mask')?.innerHTML
      cleanup()
      render(
        <PlaylistsField
          library={library}
          label="playlists"
          tree={TREE}
          options={OPTIONS}
          value={[]}
          onChange={vi.fn()}
        />,
      )
      expect(own).toBeTruthy()
      expect(maskOf(screen.getByTestId(testId))).toBe(own)
    },
  )
})
