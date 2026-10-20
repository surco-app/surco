// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../../preload/api'
import { BUNDLED_FLOWS, MY_FLOW, ONE_AT_32 } from '../../../../shared/cueFlows'
import type { CueJumpBars } from '../../../../shared/cueJump'
import type { LearnedFlow } from '../../../../shared/learnFlow'
import i18n from '../../i18n'
import type { SyncedDraft } from '../../lib/settingsDraft'
import { installApi } from '../../test/api'
import { CuesTab } from './CuesTab'

let afterTest: (() => unknown) | null = null

afterEach(async () => {
  cleanup()
  await afterTest?.()
  afterTest = null
})

let last: Pick<SyncedDraft, 'cueFlows' | 'activeCueFlow' | 'cueJumpBars'> | null = null

function Harness({ active = 'mine', collection = '' }: { active?: string; collection?: string }) {
  const [draft, setDraft] = useState({
    cueFlows: BUNDLED_FLOWS,
    activeCueFlow: active,
    cueJumpBars: 16 as CueJumpBars,
  })
  last = draft
  return (
    <CuesTab
      synced={draft as unknown as SyncedDraft}
      patch={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
      rekordboxCollection={collection}
    />
  )
}

describe('CuesTab', () => {
  it('shows the flows as tabs, the one in use marked and the current one named in place', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    expect(screen.getByTestId('cue-flow-mine')).toHaveTextContent('En uso')
    expect(
      within(screen.getByTestId('cue-flow-mine')).getByTestId('cue-flow-name'),
    ).toHaveAttribute('placeholder', 'Mi flujo')
    expect(screen.getByTestId('cue-flow-one-at-32')).toHaveTextContent('Una cue a 32')
    expect(screen.getByTestId('cue-flow-calls-only')).toHaveTextContent('Solo CALL')
  })

  it('says Mi flujo is in use when the stored active flow no longer exists, since that is the flow that runs', () => {
    render(<Harness active="gone" />)
    expect(screen.getByTestId('cue-flow-in-use')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-flow-use')).toBeNull()
  })

  it('recalculates the preview live when a block changes', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-0-repeat'))
    fireEvent.click(screen.getByTestId('cue-rule-0-repeat-option-1'))
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.rules[0].repeat).toBe(1)
    expect(screen.queryByTestId('cue-rule-0-repeat-menu')).toBeNull()
  })

  it('adds and removes a rule', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-flow-calls-only'))
    expect(screen.getByTestId('cue-flow-no-rules')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-add'))
    expect(screen.getByTestId('cue-rule-0')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-0-remove'))
    expect(screen.getByTestId('cue-flow-no-rules')).toBeInTheDocument()
  })

  it('closes an open colour popover when a rule is removed so it never lands on another rule', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-palette')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-0-remove'))
    expect(screen.queryByTestId('cue-palette')).toBeNull()
  })

  it('opens rekordbox picker with Restablecer from a rule colour', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-palette-reset')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-palette-reset'))
    expect(screen.queryByTestId('cue-palette')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-palette-22')).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens a rule colour picker towards the left when Settings would cut its right side, so every colour and Restablecer stay reachable', () => {
    const rect = (left: number, width: number) =>
      ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 0,
        height: 0,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    let scrollerRight = 1093
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-testid') === 'scroller') return rect(0, scrollerRight)
      if (this.getAttribute('data-testid') === 'cue-rule-1-color-0-palette') return rect(0, 114)
      return rect(1008, 18)
    })
    afterTest = () => spy.mockRestore()
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        <Harness />
      </div>,
    )
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-rule-1-color-0-palette')).toHaveAttribute('data-align', 'right')
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    scrollerRight = 1400
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-rule-1-color-0-palette')).toHaveAttribute('data-align', 'left')
  })

  it('hides direction and repeat for a cue on the origin itself', () => {
    render(<Harness />)
    expect(screen.queryByTestId('cue-rule-1-direction')).toBeNull()
    expect(screen.queryByTestId('cue-rule-1-repeat')).toBeNull()
  })

  it('warns that a loose CALL from a rule reads as a drop next time', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-0-place'))
    fireEvent.click(screen.getByTestId('cue-rule-0-place-option-call'))
    expect(screen.getByTestId('cue-rule-0-loose-call')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-rule-0-color-mode')).toBeNull()
  })

  it('creates a flow, names it and makes it the one in use', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-flow-new'))
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Mis 64' } })
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    const made = last?.cueFlows.find((f) => f.name === 'Mis 64')
    expect(made).toBeDefined()
    expect(last?.activeCueFlow).toBe(made?.id)
  })

  it('never offers to delete Mi flujo but restores it to rules.py', () => {
    render(<Harness />)
    expect(screen.queryByTestId('cue-flow-delete')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    fireEvent.click(screen.getByTestId('cue-rule-0-bars-option-8'))
    fireEvent.click(screen.getByTestId('cue-flow-restore'))
    expect(last?.cueFlows.find((f) => f.id === 'mine')).toEqual(MY_FLOW)
  })

  it('deletes another flow and falls back to Mi flujo when it was in use', () => {
    render(<Harness active="one-at-32" />)
    fireEvent.click(screen.getByTestId('cue-flow-one-at-32'))
    fireEvent.click(screen.getByTestId('cue-flow-delete'))
    expect(last?.cueFlows.map((f) => f.id)).toEqual(['mine', 'calls-only'])
    expect(last?.activeCueFlow).toBe('mine')
  })

  it('reads each rule as one sentence, the way the DJ would say it', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    expect(screen.getByTestId('cue-rule-0')).toHaveTextContent(
      'Desde donde rompe, hacia atrás, cada 16 compases, 3 veces, si cabe, pon hot cue + CALL',
    )
    expect(screen.getByTestId('cue-rule-1')).toHaveTextContent(
      'Desde el primer golpe, en el mismo golpe, si no hay otra antes de donde rompe, pon hot cue + CALL',
    )
  })

  it('opens one block list at a time and closes it with Escape or a click elsewhere', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(screen.getByTestId('cue-rule-0-when-option-always')).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByTestId('cue-rule-0-when-option-fits')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    expect(screen.queryByTestId('cue-rule-0-when-menu')).toBeNull()
    fireEvent.keyDown(screen.getByTestId('cue-rule-0-bars-menu'), { key: 'Escape' })
    expect(screen.queryByTestId('cue-rule-0-bars-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-rule-0-from'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('cue-rule-0-from-menu')).toBeNull()
  })

  it('puts the preview first and the rules under it', () => {
    render(<Harness />)
    const preview = screen.getByTestId('cue-flow-preview')
    expect(
      preview.compareDocumentPosition(screen.getByTestId('cue-rule-0')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('sets the arrow jump of the manual editor in its own card', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-jump-16')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cue-jump-32'))
    expect(last?.cueJumpBars).toBe(32)
    expect(screen.getByTestId('cue-jump-32')).toHaveAttribute('aria-pressed', 'true')
  })

  describe('Aprender de mi colección', () => {
    const LEARNED: LearnedFlow = {
      flow: { id: 'learned', name: '', rules: ONE_AT_32.rules },
      coverage: { matching: 18, marked: 20 },
    }

    function learnable(result: Promise<LearnedFlow | null>) {
      const rekordboxLearnFlow = vi.fn<Api['rekordboxLearnFlow']>(() => result)
      installApi({ rekordboxLearnFlow })
      render(<Harness collection="/rb/master.db" />)
      return rekordboxLearnFlow
    }

    it('stays visible but disabled without a rekordbox collection, since there is nothing to learn from', () => {
      installApi()
      render(<Harness />)
      expect(screen.getByTestId('cue-learn')).toBeDisabled()
    })

    it('spins while the collection is read and shows the proposal with its coverage', async () => {
      await i18n.changeLanguage('es')
      afterTest = () => i18n.changeLanguage('en')
      let finish: (value: LearnedFlow | null) => void = () => {}
      learnable(
        new Promise((done) => {
          finish = done
        }),
      )
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(screen.getByTestId('cue-learn-spinner')).toBeInTheDocument()
      expect(screen.getByTestId('cue-learn')).toBeDisabled()
      await act(async () => finish(LEARNED))
      expect(screen.queryByTestId('cue-learn-spinner')).toBeNull()
      const proposal = screen.getByTestId('cue-learned')
      expect(proposal).toHaveTextContent('Aprendido de mi colección')
      expect(proposal).toHaveTextContent('Encaja con 18 de 20 pistas')
      expect(within(proposal).getByTestId('cue-flow-preview')).toBeInTheDocument()
      expect(last?.cueFlows).toEqual(BUNDLED_FLOWS)
      expect(last?.activeCueFlow).toBe('mine')
    })

    it('saves the proposal as a new flow in use only on "Usar este flujo"', async () => {
      await i18n.changeLanguage('es')
      afterTest = () => i18n.changeLanguage('en')
      learnable(Promise.resolve(LEARNED))
      fireEvent.click(screen.getByTestId('cue-learn'))
      fireEvent.click(await screen.findByTestId('cue-learned-use'))
      const made = last?.cueFlows.find((f) => !BUNDLED_FLOWS.some((b) => b.id === f.id))
      expect(made).toEqual({
        id: expect.any(String),
        name: 'Aprendido de mi colección',
        rules: ONE_AT_32.rules,
      })
      expect(made?.id).not.toBe('learned')
      expect(last?.cueFlows.slice(0, 3)).toEqual(BUNDLED_FLOWS)
      expect(last?.activeCueFlow).toBe(made?.id)
      expect(screen.queryByTestId('cue-learned')).toBeNull()
    })

    it('says pista in the singular when a single track is marked', async () => {
      await i18n.changeLanguage('es')
      afterTest = () => i18n.changeLanguage('en')
      learnable(Promise.resolve({ ...LEARNED, coverage: { matching: 1, marked: 1 } }))
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(await screen.findByTestId('cue-learned-coverage')).toHaveTextContent(
        'Encaja con 1 de 1 pista',
      )
      expect(screen.getByTestId('cue-learned-coverage')).not.toHaveTextContent('pistas')
    })

    it('discards the proposal without touching the flows', async () => {
      learnable(Promise.resolve(LEARNED))
      fireEvent.click(screen.getByTestId('cue-learn'))
      fireEvent.click(await screen.findByTestId('cue-learned-discard'))
      expect(screen.queryByTestId('cue-learned')).toBeNull()
      expect(last?.cueFlows).toEqual(BUNDLED_FLOWS)
      expect(last?.activeCueFlow).toBe('mine')
    })

    it('says the collection has no clear pattern when nothing is learned', async () => {
      await i18n.changeLanguage('es')
      afterTest = () => i18n.changeLanguage('en')
      learnable(Promise.resolve(null))
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(await screen.findByTestId('cue-learn-none')).toHaveTextContent(
        'Tu colección no tiene un patrón claro',
      )
      expect(last?.cueFlows).toEqual(BUNDLED_FLOWS)
    })

    it('drops a result that arrives after the DJ moved to another flow and keeps the button busy until it does', async () => {
      let finish: (value: LearnedFlow | null) => void = () => {}
      const rekordboxLearnFlow = learnable(
        new Promise((done) => {
          finish = done
        }),
      )
      fireEvent.click(screen.getByTestId('cue-learn'))
      fireEvent.click(screen.getByTestId('cue-flow-one-at-32'))
      expect(screen.getByTestId('cue-learn')).toBeDisabled()
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(rekordboxLearnFlow).toHaveBeenCalledTimes(1)
      await act(async () => finish(LEARNED))
      expect(screen.queryByTestId('cue-learned')).toBeNull()
      expect(screen.getByTestId('cue-flow-name')).toBeInTheDocument()
      expect(screen.getByTestId('cue-learn')).toBeEnabled()
    })

    it('says the collection could not be read instead of spinning forever', async () => {
      learnable(Promise.reject(new Error('locked')))
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(await screen.findByTestId('cue-learn-failed')).toBeInTheDocument()
      expect(screen.queryByTestId('cue-learn-spinner')).toBeNull()
    })
  })
})
