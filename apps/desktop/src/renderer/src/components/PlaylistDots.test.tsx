// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import { PlaylistDots } from './PlaylistDots'

afterEach(cleanup)

describe('PlaylistDots', () => {
  it('draws one dot per playlist up to four and names them', () => {
    render(<PlaylistDots dot={{ names: ['Makina', 'Cierre'], pending: false }} />)
    const dots = screen.getByTestId('track-playlist-dots')
    expect(dots.querySelectorAll('[data-dot]')).toHaveLength(2)
    expect(dots).toHaveTextContent('Makina, Cierre')
  })

  it('keeps repeated playlist names as separate dots', () => {
    render(<PlaylistDots dot={{ names: ['Todas', 'Todas', 'Top'], pending: false }} />)
    expect(screen.getByTestId('track-playlist-dots').querySelectorAll('[data-dot]')).toHaveLength(3)
  })

  it('says 5+ from five playlists on', () => {
    render(<PlaylistDots dot={{ names: ['a', 'b', 'c', 'd', 'e', 'f'], pending: false }} />)
    expect(screen.getByTestId('track-playlist-dots')).toHaveTextContent('5+')
    expect(screen.getByTestId('track-playlist-dots').querySelectorAll('[data-dot]')).toHaveLength(0)
  })

  it('draws pending dots hollow until the queue lands in rekordbox', () => {
    render(<PlaylistDots dot={{ names: ['Cierre'], pending: true }} />)
    expect(screen.getByTestId('track-playlist-dots')).toHaveAttribute('data-pending', 'true')
  })
})
