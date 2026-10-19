// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { RekordboxPlaylistTarget } from '../../../shared/types'
import type { PlaylistOption } from '../lib/rekordboxPlaylists'
import { PlaylistsBulkField, PlaylistsField } from './PlaylistsField'

afterEach(cleanup)

const OPTIONS: PlaylistOption[] = [
  { id: '1001', name: 'Bolos de verano', path: 'BOLOS' },
  { id: '1101', name: 'Todas', path: 'BOLOS › FIJAS' },
  { id: '2000', name: 'Todas', path: '' },
  { id: '3000', name: 'Makina', path: '' },
]

function Harness({ initial = [] as RekordboxPlaylistTarget[], spy = vi.fn() }) {
  const [value, setValue] = useState(initial)
  return (
    <PlaylistsField
      label="Playlists"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        spy(next)
        setValue(next)
      }}
    />
  )
}

const input = () => screen.getByTestId('playlists-input')

describe('PlaylistsField', () => {
  it('filters by name and shows each option with its folder path, since two playlists can share a name', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: 'tod' } })
    expect(screen.getByTestId('playlists-option-1101')).toHaveTextContent('BOLOS › FIJAS')
    expect(screen.getByTestId('playlists-option-2000')).toBeInTheDocument()
    expect(screen.queryByTestId('playlists-option-3000')).toBeNull()
  })

  it('picks the highlighted option with Enter, as Mail does', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    fireEvent.change(input(), { target: { value: 'mak' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(spy).toHaveBeenLastCalledWith([{ id: '3000', name: 'Makina' }])
    expect(screen.getByTestId('playlists-token-3000')).toHaveTextContent('Makina')
    expect(input()).toHaveValue('')
  })

  it('moves the highlight with the arrows', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    fireEvent.change(input(), { target: { value: 'tod' } })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(spy).toHaveBeenLastCalledWith([{ id: '2000', name: 'Todas' }])
  })

  it('picks an option by clicking it', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    fireEvent.change(input(), { target: { value: 'mak' } })
    fireEvent.click(screen.getByTestId('playlists-option-3000'))
    expect(spy).toHaveBeenLastCalledWith([{ id: '3000', name: 'Makina' }])
  })

  it('removes the last token with Backspace on an empty box', () => {
    const spy = vi.fn()
    render(
      <Harness
        spy={spy}
        initial={[
          { id: '3000', name: 'Makina' },
          { id: '2000', name: 'Todas' },
        ]}
      />,
    )
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(spy).toHaveBeenLastCalledWith([{ id: '3000', name: 'Makina' }])
  })

  it('removes one token with its own button', () => {
    const spy = vi.fn()
    render(
      <Harness
        spy={spy}
        initial={[
          { id: '3000', name: 'Makina' },
          { id: '2000', name: 'Todas' },
        ]}
      />,
    )
    fireEvent.click(screen.getByTestId('playlists-token-remove-3000'))
    expect(spy).toHaveBeenLastCalledWith([{ id: '2000', name: 'Todas' }])
  })

  it('puts the folder path in the token tooltip', () => {
    render(<Harness initial={[{ id: '1101', name: 'Todas' }]} />)
    expect(screen.getByTestId('playlists-token-1101')).toHaveAttribute('title', 'BOLOS › FIJAS')
  })

  it('offers to create a playlist the text does not name exactly, and marks it pending until the track is written', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    fireEvent.change(input(), { target: { value: 'Makina' } })
    expect(screen.queryByTestId('playlists-create')).toBeNull()
    fireEvent.change(input(), { target: { value: 'Cierre' } })
    fireEvent.click(screen.getByTestId('playlists-create'))
    expect(spy).toHaveBeenLastCalledWith([{ name: 'Cierre' }])
    expect(screen.getByTestId('playlists-token-new:Cierre')).toHaveAttribute('data-pending', 'true')
  })

  it('creates with Enter when the create row is the only one', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    fireEvent.change(input(), { target: { value: 'Cierre' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(spy).toHaveBeenLastCalledWith([{ name: 'Cierre' }])
  })

  it('does not offer again the root playlist an id-less chosen name already stands for', () => {
    render(<Harness initial={[{ name: 'Makina' }]} />)
    fireEvent.change(input(), { target: { value: 'mak' } })
    expect(screen.queryByTestId('playlists-option-3000')).toBeNull()
  })
})

describe('PlaylistsBulkField', () => {
  const states = [
    { target: { id: '3000', name: 'Makina' }, state: 'all' as const },
    { target: { id: '2000', name: 'Todas' }, state: 'some' as const },
  ]

  it('completes a half token for all the tracks on click, like the Grouping chips in bulk', () => {
    const onToggle = vi.fn()
    render(
      <PlaylistsBulkField
        label="Playlists"
        options={OPTIONS}
        states={states}
        onToggle={onToggle}
      />,
    )
    expect(screen.getByTestId('playlists-token-2000')).toHaveAttribute('data-state', 'some')
    fireEvent.click(screen.getByTestId('playlists-token-complete-2000'))
    expect(onToggle).toHaveBeenCalledWith({ id: '2000', name: 'Todas' }, true)
  })

  it('removes a token from every track', () => {
    const onToggle = vi.fn()
    render(
      <PlaylistsBulkField
        label="Playlists"
        options={OPTIONS}
        states={states}
        onToggle={onToggle}
      />,
    )
    fireEvent.click(screen.getByTestId('playlists-token-remove-3000'))
    expect(onToggle).toHaveBeenCalledWith({ id: '3000', name: 'Makina' }, false)
  })

  it('adds a picked playlist to every track', () => {
    const onToggle = vi.fn()
    render(
      <PlaylistsBulkField
        label="Playlists"
        options={OPTIONS}
        states={states}
        onToggle={onToggle}
      />,
    )
    fireEvent.change(input(), { target: { value: 'bolos' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onToggle).toHaveBeenCalledWith({ id: '1001', name: 'Bolos de verano' }, true)
  })
})
