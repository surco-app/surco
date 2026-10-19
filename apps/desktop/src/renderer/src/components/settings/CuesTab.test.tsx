// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../../preload/api'
import { BUNDLED_FLOWS, MY_FLOW, ONE_AT_32 } from '../../../../shared/cueFlows'
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

let last: Pick<SyncedDraft, 'cueFlows' | 'activeCueFlow'> | null = null

function Harness({ active = 'mine', collection = '' }: { active?: string; collection?: string }) {
  const [draft, setDraft] = useState({ cueFlows: BUNDLED_FLOWS, activeCueFlow: active })
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
  it('lists the bundled flows by their translated names with Mi flujo in use', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    expect(
      within(screen.getByTestId('cue-flows'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(expect.arrayContaining(['Mi flujo', 'Una cue a 32', 'Solo CALL']))
    expect(screen.getByTestId('cue-flow-in-use')).toBeInTheDocument()
  })

  it('recalculates the preview live when a block changes', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('cue-rule-0-repeat'), { target: { value: '1' } })
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.rules[0].repeat).toBe(1)
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

  it('hides direction and repeat for a cue on the origin itself', () => {
    render(<Harness />)
    expect(screen.queryByTestId('cue-rule-1-direction')).toBeNull()
    expect(screen.queryByTestId('cue-rule-1-repeat')).toBeNull()
  })

  it('warns that a loose CALL from a rule reads as a drop next time', () => {
    render(<Harness />)
    fireEvent.change(screen.getByTestId('cue-rule-0-place'), { target: { value: 'call' } })
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
    fireEvent.change(screen.getByTestId('cue-rule-0-bars'), { target: { value: '8' } })
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
