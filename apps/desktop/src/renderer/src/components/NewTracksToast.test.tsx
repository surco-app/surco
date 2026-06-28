// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { NewTracksToast } from './NewTracksToast'

afterEach(cleanup)

describe('NewTracksToast', () => {
  it('renders nothing when there is nothing pending', () => {
    const { container } = render(
      <NewTracksToast pending={null} onLoad={vi.fn()} onDismiss={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('names the folder by its basename so the user knows which crate grew', () => {
    // The watcher reports an absolute root path; the user thinks in folder names, not paths.
    render(
      <NewTracksToast
        pending={{ root: '/Users/dj/Music/House', paths: ['/Users/dj/Music/House/a.wav'] }}
        onLoad={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByTestId('new-tracks-message')).toHaveTextContent('House')
  })

  it('pluralizes the count so one track does not read "1 tracks"', () => {
    render(
      <NewTracksToast
        pending={{ root: '/m/Set', paths: ['/m/Set/a.wav'] }}
        onLoad={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByTestId('new-tracks-message')).toHaveTextContent('1 new track in')
  })

  it('loads on accept and dismisses on the close button — the two answers the prompt offers', () => {
    const onLoad = vi.fn()
    const onDismiss = vi.fn()
    render(
      <NewTracksToast
        pending={{ root: '/m/Set', paths: ['/m/Set/a.wav', '/m/Set/b.flac'] }}
        onLoad={onLoad}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByTestId('new-tracks-load'))
    fireEvent.click(screen.getByTestId('new-tracks-dismiss'))
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
