// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { SourceNode } from '../../../shared/types'
import { playlistOptions } from '../lib/rekordboxPlaylists'
import { PlaylistTree } from './PlaylistTree'

afterEach(cleanup)

const TREE: SourceNode[] = [
  {
    id: 'bases',
    name: 'BASES',
    kind: 'folder',
    count: 1,
    children: [{ id: 'b90', name: 'Bases 90', kind: 'playlist', count: 12 }],
  },
  { id: 'mash', name: 'Mashups', kind: 'playlist', count: 9 },
]

function renderTree(props: Partial<React.ComponentProps<typeof PlaylistTree>> = {}) {
  const onToggle = vi.fn()
  render(
    <PlaylistTree
      tree={TREE}
      options={playlistOptions(TREE)}
      tokens={[]}
      onToggle={onToggle}
      onEscape={vi.fn()}
      {...props}
    />,
  )
  return onToggle
}

describe('PlaylistTree with a control on every playlist', () => {
  it('draws the control instead of a checkbox, so a playlist can take more than a yes or no', () => {
    renderTree({ control: (t) => <button type="button" data-testid={`control-${t.id}`} /> })
    expect(screen.getByTestId('control-mash')).toBeInTheDocument()
    expect(screen.queryByTestId('playlists-check-mash')).toBeNull()
  })

  it('shows the control of a playlist inside a folder once the folder is opened', () => {
    renderTree({ control: (t) => <button type="button" data-testid={`control-${t.id}`} /> })
    expect(screen.queryByTestId('control-b90')).toBeNull()
    fireEvent.click(screen.getByTestId('playlists-folder-bases'))
    expect(screen.getByTestId('control-b90')).toBeInTheDocument()
  })

  it('does not toggle anything when Enter finds a single match, because the control decides', () => {
    const onToggle = renderTree({
      control: (t) => <button type="button" data-testid={`control-${t.id}`} />,
    })
    const search = screen.getByTestId('playlists-search')
    fireEvent.change(search, { target: { value: 'mash' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onToggle).not.toHaveBeenCalled()
  })
})

describe('PlaylistTree without creating playlists', () => {
  it('offers to create a playlist by default when the name matches none', () => {
    renderTree()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'Nueva' } })
    expect(screen.getByTestId('playlists-create')).toBeInTheDocument()
  })

  it('offers no creation when it is turned off', () => {
    renderTree({ allowCreate: false })
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'Nueva' } })
    expect(screen.queryByTestId('playlists-create')).toBeNull()
  })
})

describe('PlaylistTree when nothing matches', () => {
  it('says what it was told to say, only once something was typed', () => {
    renderTree({ allowCreate: false, emptyText: 'Nothing here' })
    expect(screen.queryByTestId('playlists-empty')).toBeNull()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('playlists-empty')).toHaveTextContent('Nothing here')
  })

  it('stays silent when a playlist matches', () => {
    renderTree({ allowCreate: false, emptyText: 'Nothing here' })
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'mash' } })
    expect(screen.queryByTestId('playlists-empty')).toBeNull()
  })
})

describe('PlaylistTree search label', () => {
  it('offers to search or create by default', () => {
    renderTree()
    expect(screen.getByTestId('playlists-search')).toHaveAttribute(
      'placeholder',
      'Search or create a playlist',
    )
  })

  it('says only what it was told when it cannot create, so it does not promise what it will not do', () => {
    renderTree({ allowCreate: false, searchLabel: 'Search a playlist' })
    const search = screen.getByTestId('playlists-search')
    expect(search).toHaveAttribute('placeholder', 'Search a playlist')
    expect(search).toHaveAttribute('aria-label', 'Search a playlist')
  })
})

describe('PlaylistTree focus', () => {
  it('puts the focus on the search by default', () => {
    renderTree()
    expect(screen.getByTestId('playlists-search')).toHaveFocus()
  })

  it('leaves the focus where it was when asked not to take it', () => {
    renderTree({ autoFocus: false })
    expect(screen.getByTestId('playlists-search')).not.toHaveFocus()
  })
})

describe('PlaylistTree leaving with Escape', () => {
  it('stays quiet when nobody asked to hear about it', () => {
    renderTree({ onEscape: undefined })
    const notStopped = fireEvent.keyDown(screen.getByTestId('playlists-search'), { key: 'Escape' })
    expect(notStopped).toBe(true)
  })
})
