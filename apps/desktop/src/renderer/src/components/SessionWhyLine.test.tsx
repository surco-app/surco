// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionWhy } from '../../../shared/sessionBuild'
import type { SessionTrack } from '../../../shared/sessionTypes'
import i18n from '../i18n'
import { SessionWhyLine } from './SessionWhyLine'

afterEach(cleanup)

const placedTrack = (id: string, over: Partial<SessionTrack> = {}): SessionTrack => ({
  id,
  role: 'any',
  key: '8A',
  bpm: 140,
  rating: 0,
  plays: 0,
  secs: 300,
  fresh: false,
  title: `Title ${id}`,
  artist: `Artist ${id}`,
  ...over,
})

function setup(
  why: SessionWhy,
  props: { busy?: boolean; locked?: boolean; track?: SessionTrack } = {},
) {
  const onToggleLock = vi.fn()
  render(
    <SessionWhyLine
      track={props.track ?? placedTrack('placed')}
      why={why}
      busy={props.busy ?? false}
      locked={props.locked ?? false}
      onToggleLock={onToggleLock}
    />,
  )
  return { onToggleLock }
}

const line = () => screen.getByTestId('session-why')

describe('SessionWhyLine text', () => {
  it('says the track opens or closes the session', () => {
    setup({ kind: 'phase', phase: 'open' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.phaseOpen'))
    cleanup()
    setup({ kind: 'phase', phase: 'close' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.phaseClose'))
    expect(line().textContent).not.toContain(i18n.t('sessions.why.start'))
  })

  it('says a combo was proven and in how many sets', () => {
    setup({ kind: 'combo', sets: 5 })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.combo', { count: 5 }))
  })

  it('says a track played right after the one before it in a set', () => {
    setup({ kind: 'partner' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.partner'))
    expect(line().textContent).not.toContain(i18n.t('sessions.why.start'))
  })

  it('names the keys of a harmonic mix and how they relate', () => {
    setup({ kind: 'harmonic', from: '8A', to: '8A', distance: 0 })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.harmonicSame', { from: '8A', to: '8A' }))
    cleanup()
    setup({ kind: 'harmonic', from: '8A', to: '8B', distance: 1 })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.harmonicRing', { from: '8A', to: '8B' }))
    cleanup()
    setup({ kind: 'harmonic', from: '8A', to: '9A', distance: 1 })
    expect(line()).toHaveTextContent(
      i18n.t('sessions.why.harmonicNeighbour', { from: '8A', to: '9A' }),
    )
  })

  it('says how many stars a track has when it was picked for them', () => {
    setup({ kind: 'taste', plays: 40, rating: 80 })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.tasteRated', { stars: 4 }))
    expect(line().textContent).toContain('4')
    cleanup()
    setup({ kind: 'taste', plays: 0, rating: 100 })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.tasteRated', { stars: 5 }))
  })

  it('says how many times a track was played when it was picked for that and has no stars', () => {
    setup({ kind: 'taste', plays: 40, rating: 0 })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.tastePlayed', { count: 40 }))
    expect(line().textContent).toContain('40')
    cleanup()
    setup({ kind: 'taste', plays: 1, rating: 0 })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.tastePlayed', { count: 1 }))
  })

  it('says it fit by tempo, and when it had to stretch the tempo', () => {
    setup({ kind: 'bpm', relaxed: false })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.bpm'))
    cleanup()
    setup({ kind: 'bpm', relaxed: true })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.bpmRelaxed'))
  })

  it('calls a new track new and says what it fit by', () => {
    setup({ kind: 'fresh', key: '10A', role: 'base' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.freshKey', { key: '10A' }))
    cleanup()
    setup({ kind: 'fresh', key: null, role: 'any' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.freshTempo'))
  })

  it('says where the session started and when the user chose the track', () => {
    setup({ kind: 'start' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.start'))
    cleanup()
    setup({ kind: 'chosen' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.chosen'))
  })
})

describe('SessionWhyLine tempo', () => {
  it('shows the tempo of the placed track whatever it was picked for, and leaves the key to the row above it', () => {
    setup({ kind: 'combo', sets: 2 }, { track: placedTrack('p', { key: '11A', bpm: 142.05 }) })
    expect(screen.getByTestId('session-why-track')).toHaveTextContent(/^142$/)
  })

  it('leaves the slot out when the track has no tempo', () => {
    setup({ kind: 'start' }, { track: placedTrack('p', { key: '4B', bpm: 0 }) })
    expect(screen.queryByTestId('session-why-track')).toBeNull()
  })
})

describe('SessionWhyLine locking', () => {
  it('offers a lock on every row, not pressed until it is locked', () => {
    setup({ kind: 'combo', sets: 2 })
    const lock = screen.getByTestId('session-why-lock')
    expect(lock).toHaveAttribute('aria-pressed', 'false')
    expect(lock).toHaveAccessibleName(i18n.t('sessions.why.lock'))
  })

  it('hands the press over', () => {
    const spy = setup({ kind: 'combo', sets: 2 })
    fireEvent.click(screen.getByTestId('session-why-lock'))
    expect(spy.onToggleLock).toHaveBeenCalledOnce()
  })

  it('shows it pressed, and offers to unlock, when the track is locked', () => {
    setup({ kind: 'combo', sets: 2 }, { locked: true })
    const lock = screen.getByTestId('session-why-lock')
    expect(lock).toHaveAttribute('aria-pressed', 'true')
    expect(lock).toHaveAccessibleName(i18n.t('sessions.why.unlock'))
  })

  it('blocks it while the playlist is being rewritten', () => {
    setup({ kind: 'combo', sets: 2 }, { busy: true })
    expect(screen.getByTestId('session-why-lock')).toBeDisabled()
  })
})
