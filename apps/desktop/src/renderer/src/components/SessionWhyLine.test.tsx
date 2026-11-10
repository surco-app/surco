// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionWhy } from '../../../shared/sessionBuild'
import type { SessionTrack } from '../../../shared/sessionTypes'
import i18n from '../i18n'
import { SessionWhyLine } from './SessionWhyLine'

afterEach(cleanup)

const alt = (id: string, over: Partial<SessionTrack> = {}): SessionTrack => ({
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
  props: {
    canChange?: boolean
    busy?: boolean
    alts?: SessionTrack[]
    locked?: boolean
    track?: SessionTrack
  } = {},
) {
  const onPick = vi.fn()
  const onToggleLock = vi.fn()
  const alternatives = vi.fn(() => props.alts ?? [])
  render(
    <SessionWhyLine
      track={props.track ?? alt('placed')}
      why={why}
      canChange={props.canChange ?? true}
      busy={props.busy ?? false}
      alternatives={alternatives}
      onPick={onPick}
      locked={props.locked ?? false}
      onToggleLock={onToggleLock}
    />,
  )
  return Object.assign(onPick, { alternatives, onToggleLock })
}

const line = () => screen.getByTestId('session-why')

describe('SessionWhyLine text', () => {
  it('says the track opens, closes or is one the DJ always plays', () => {
    setup({ kind: 'phase', phase: 'open' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.phaseOpen'))
    cleanup()
    setup({ kind: 'phase', phase: 'close' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.phaseClose'))
    cleanup()
    setup({ kind: 'phase', phase: 'must' })
    expect(line()).toHaveTextContent(i18n.t('sessions.why.phaseMust'))
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

describe('SessionWhyLine key and tempo', () => {
  it('shows the key and tempo of the placed track whatever it was picked for, so the DJ can check the mix by ear', () => {
    setup({ kind: 'combo', sets: 2 }, { track: alt('p', { key: '11A', bpm: 142.05 }) })
    expect(screen.getByTestId('session-why-track')).toHaveTextContent('11A 142')
    cleanup()
    setup({ kind: 'taste', rating: 100, plays: 0 }, { track: alt('p', { key: '4B', bpm: 0 }) })
    expect(screen.getByTestId('session-why-track')).toHaveTextContent(/^4B$/)
  })

  it('leaves the slot out when the track has neither key nor tempo', () => {
    setup({ kind: 'start' }, { track: alt('p', { key: null, bpm: 0 }) })
    expect(screen.queryByTestId('session-why-track')).toBeNull()
  })
})

describe('SessionWhyLine swapping', () => {
  it('offers the swap on every row, without having to select it first', () => {
    setup({ kind: 'combo', sets: 2 }, { alts: [alt('x')] })
    expect(screen.getByTestId('session-why-change')).toBeInTheDocument()
  })

  it('offers no swap when the session has no track left over', () => {
    setup({ kind: 'combo', sets: 2 }, { canChange: false })
    expect(screen.queryByTestId('session-why-change')).toBeNull()
  })

  it('looks for the tracks that fit only when the list is opened', () => {
    const onPick = setup({ kind: 'combo', sets: 2 }, { alts: [alt('x')] })
    expect(onPick.alternatives).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('session-why-change'))
    expect(onPick.alternatives).toHaveBeenCalledOnce()
  })

  it('says so when nothing fits that place', () => {
    setup({ kind: 'combo', sets: 2 })
    fireEvent.click(screen.getByTestId('session-why-change'))
    expect(screen.getByTestId('session-why-none')).toHaveTextContent(i18n.t('sessions.why.noneFit'))
  })

  it('opens the list of tracks that fit, with their artist and title', () => {
    setup({ kind: 'combo', sets: 2 }, { alts: [alt('x'), alt('y')] })
    fireEvent.click(screen.getByTestId('session-why-change'))
    expect(screen.getByTestId('session-why-alt-x')).toHaveTextContent('Artist x')
    expect(screen.getByTestId('session-why-alt-x')).toHaveTextContent('Title x')
    expect(screen.getByTestId('session-why-alt-y')).toBeInTheDocument()
  })

  it('hands the chosen track over and closes the list', () => {
    const spare = alt('x')
    const onPick = setup({ kind: 'combo', sets: 2 }, { alts: [spare, alt('y')] })
    fireEvent.click(screen.getByTestId('session-why-change'))
    fireEvent.click(screen.getByTestId('session-why-alt-x'))
    expect(onPick).toHaveBeenCalledExactlyOnceWith(spare)
    expect(screen.queryByTestId('session-why-alt-x')).toBeNull()
  })

  it('shows the key and tempo of each track that fits when it has them', () => {
    setup({ kind: 'combo', sets: 2 }, { alts: [alt('x', { key: '9A', bpm: 142 })] })
    fireEvent.click(screen.getByTestId('session-why-change'))
    expect(screen.getByTestId('session-why-alt-x')).toHaveTextContent('9A')
    expect(screen.getByTestId('session-why-alt-x')).toHaveTextContent('142')
  })

  it('blocks swapping while the playlist is being rewritten', () => {
    setup({ kind: 'combo', sets: 2 }, { busy: true, alts: [alt('x')] })
    expect(screen.getByTestId('session-why-change')).toBeDisabled()
  })
})

describe('SessionWhyLine locking', () => {
  it('offers a lock on every row, not pressed until it is locked', () => {
    setup({ kind: 'combo', sets: 2 })
    const lock = screen.getByTestId('session-why-lock')
    expect(lock).toHaveAttribute('aria-pressed', 'false')
    expect(lock).toHaveAccessibleName(i18n.t('sessions.why.lock'))
  })

  it('offers it even when there is nothing to change the track for', () => {
    setup({ kind: 'start' }, { canChange: false })
    expect(screen.getByTestId('session-why-lock')).toBeInTheDocument()
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

  it('does not open the list of tracks to change to', () => {
    const spy = setup({ kind: 'combo', sets: 2 }, { alts: [alt('x')] })
    fireEvent.click(screen.getByTestId('session-why-lock'))
    expect(spy.alternatives).not.toHaveBeenCalled()
  })
})
