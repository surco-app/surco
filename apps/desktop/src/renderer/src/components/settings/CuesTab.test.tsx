// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../../preload/api'
import {
  BUNDLED_FLOWS,
  CALLS_ONLY,
  type CueFlow,
  MIX_IN,
  MIX_IN_32,
  MY_FLOW,
  ONE_AT_32,
} from '../../../../shared/cueFlows'
import type { CueJumpBars } from '../../../../shared/cueJump'
import type { CueQuantize } from '../../../../shared/cueQuantize'
import type { LearnedFlow } from '../../../../shared/learnFlow'
import i18n from '../../i18n'
import { EXAMPLE_DROP } from '../../lib/cueExample'
import type { SyncedDraft } from '../../lib/settingsDraft'
import { installApi } from '../../test/api'
import { CuesTab } from './CuesTab'

let afterTest: (() => unknown) | null = null

afterEach(async () => {
  cleanup()
  await afterTest?.()
  afterTest = null
})

let last: Pick<
  SyncedDraft,
  'cueFlows' | 'activeCueFlow' | 'cueJumpBars' | 'cueQuantize' | 'cueLettersByTime'
> | null = null

const KEPT: CueFlow[] = [MIX_IN, MY_FLOW, ONE_AT_32, CALLS_ONLY]

function Harness({
  active = 'mine',
  collection = '',
  flows = KEPT,
}: {
  active?: string
  collection?: string
  flows?: CueFlow[]
}) {
  const [draft, setDraft] = useState({
    cueFlows: flows,
    activeCueFlow: active,
    cueJumpBars: 16 as CueJumpBars,
    cueQuantize: 'bar' as CueQuantize,
    cueLettersByTime: true,
    cueFlowToRekordbox: true,
    cueFlowToTraktor: true,
    cueFlowToEngine: true,
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

const openPicker = () => fireEvent.click(screen.getByTestId('cue-flow-picker'))
const openAdd = () => fireEvent.click(screen.getByTestId('cue-flow-add'))
const openMore = () => fireEvent.click(screen.getByTestId('cue-flow-more'))
const pick = (id: string) => {
  openPicker()
  fireEvent.click(screen.getByTestId(`cue-flow-${id}`))
}
const startRename = () => {
  openMore()
  fireEvent.click(screen.getByTestId('cue-flow-rename'))
}

describe('CuesTab', () => {
  // The rules are shared by every library, and two of their parts only fully reach
  // rekordbox: CALLs (only rekordbox has them) and colours (Traktor paints by cue type).
  it('says under the rules what reaches Engine DJ and Traktor, only where they are installed', async () => {
    installApi({ traktorAvailable: async () => true, engineAvailable: async () => false })
    render(<Harness />)
    expect(await screen.findByTestId('cue-flow-library-note')).toHaveTextContent(
      'CALLs only exist in rekordbox. Engine DJ and Traktor get the hot cues only. In Traktor these cues show in blue, since Traktor colours each cue by its type',
    )
    cleanup()
    installApi({ traktorAvailable: async () => false, engineAvailable: async () => true })
    render(<Harness />)
    expect(await screen.findByTestId('cue-flow-library-note')).toHaveTextContent(
      /^CALLs only exist in rekordbox\. Engine DJ and Traktor get the hot cues only$/,
    )
    cleanup()
    installApi({ traktorAvailable: async () => false, engineAvailable: async () => false })
    render(<Harness />)
    await screen.findByTestId('cue-flow-mark-point')
    expect(screen.queryByTestId('cue-flow-library-note')).not.toBeInTheDocument()
  })

  it('marks the point with a CALL by default and lets a DJ who does not mark it turn that off, the preview following', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-flow-mark-point')).toBeChecked()
    expect(screen.getByTestId(`cue-wave-call-${EXAMPLE_DROP}`)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-flow-mark-point'))
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.markPoint).toBe(false)
    expect(screen.getByTestId('cue-flow-mark-point')).not.toBeChecked()
    expect(screen.queryByTestId(`cue-wave-call-${EXAMPLE_DROP}`)).toBeNull()
  })

  it('marks no flow as the default while the editor is in Manual, and Poner por defecto leaves Manual', () => {
    render(<Harness active="manual" />)
    openPicker()
    expect(screen.queryByTestId('cue-flow-in-use')).toBeNull()
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    expect(last?.activeCueFlow).toBe('mine')
  })

  it('letters the hot cues in track order by default and lets a DJ with fixed pads turn it off', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    const toggle = screen.getByTestId('settings-cue-letters-by-time')
    expect(toggle).toBeChecked()
    expect(screen.getByText('Letras en orden de la pista')).toBeInTheDocument()
    expect(screen.getByTestId('settings-cue-letters-hint')).toHaveTextContent(
      'La A siempre es la primera cue de la pista. Apágalo si cada letra es un pad fijo para ti.',
    )
    fireEvent.click(toggle)
    expect(last?.cueLettersByTime).toBe(false)
  })

  it('gives a new DJ the two bundled flows, Mix in 64 marked as the default', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness flows={BUNDLED_FLOWS} active="mix-in" />)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Mix in 64')
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Por defecto')
    openPicker()
    expect(screen.getByTestId('cue-flow-mix-in-32')).toHaveTextContent('Mix in 32')
    expect(screen.queryByTestId('cue-flow-mine')).toBeNull()
    expect(screen.queryByTestId('cue-flow-calls-only')).toBeNull()
    expect(screen.getByTestId('cue-flow-mix-in')).toHaveTextContent('Por defecto')
    expect(screen.getByTestId('cue-flow-mix-in')).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps Poner por defecto with the actions on the open flow, out of the list of flows to pick', () => {
    render(<Harness />)
    pick('one-at-32')
    openPicker()
    expect(within(screen.getByRole('menu')).queryByTestId('cue-flow-use')).toBeNull()
  })

  it('offers Poner por defecto on a flow that is not the default', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    pick('one-at-32')
    openMore()
    expect(screen.getByTestId('cue-flow-use')).toHaveTextContent('Poner por defecto')
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    expect(last?.activeCueFlow).toBe('one-at-32')
  })

  it('lists the flows an earlier Surco kept with their names, the default marked', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    openPicker()
    expect(screen.getByTestId('cue-flow-mine')).toHaveTextContent('Mi flujo')
    expect(screen.getByTestId('cue-flow-mine')).toHaveTextContent('Por defecto')
    expect(screen.getByTestId('cue-flow-one-at-32')).toHaveTextContent('Una cue a 32')
    expect(screen.getByTestId('cue-flow-calls-only')).toHaveTextContent('Solo CALL')
  })

  it('marks the bundled flow as the default when the stored active flow no longer exists, since that is the flow that runs', () => {
    render(<Harness flows={BUNDLED_FLOWS} active="gone" />)
    openPicker()
    expect(
      within(screen.getByTestId('cue-flow-mix-in')).getByTestId('cue-flow-in-use'),
    ).toBeInTheDocument()
    openMore()
    expect(screen.getByTestId('cue-flow-use')).toBeDisabled()
  })

  it('keeps marking the Mi flujo an earlier Surco kept when the stored active flow no longer exists, as main still runs it', () => {
    render(<Harness active="gone" />)
    openPicker()
    expect(
      within(screen.getByTestId('cue-flow-mine')).getByTestId('cue-flow-in-use'),
    ).toBeInTheDocument()
    openMore()
    expect(screen.getByTestId('cue-flow-use')).toBeDisabled()
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
    pick('calls-only')
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

  it('gives the focus back to the token when its list closes, so Escape closes the list first and Settings only after', () => {
    const settingsEscape = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', settingsEscape)
    afterTest = () => window.removeEventListener('keydown', settingsEscape)
    render(<Harness />)
    const token = screen.getByTestId('cue-rule-0-bars')
    fireEvent.click(token)
    screen.getByTestId('cue-rule-0-bars-option-8').focus()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByTestId('cue-rule-0-bars-menu')).toBeNull()
    expect(settingsEscape).not.toHaveBeenCalled()
    expect(token).toHaveFocus()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(settingsEscape).toHaveBeenCalledTimes(1)
    fireEvent.click(token)
    const option = screen.getByTestId('cue-rule-0-bars-option-8')
    option.focus()
    fireEvent.click(option)
    expect(screen.getByTestId('cue-rule-0-bars')).toHaveFocus()
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

  it('creates a flow straight into naming it, the way a new folder opens in Finder, and makes it the one in use', () => {
    render(<Harness />)
    openAdd()
    fireEvent.click(screen.getByTestId('cue-flow-new'))
    expect(screen.getByTestId('cue-flow-name')).toHaveFocus()
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Mis 64' } })
    fireEvent.keyDown(screen.getByTestId('cue-flow-name'), { key: 'Enter' })
    expect(screen.queryByTestId('cue-flow-name')).toBeNull()
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Mis 64')
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    const made = last?.cueFlows.find((f) => f.name === 'Mis 64')
    expect(made).toBeDefined()
    expect(last?.activeCueFlow).toBe(made?.id)
  })

  it('renames Mi flujo and a user flow from Cambiar nombre, the input showing what was typed', () => {
    render(<Harness />)
    startRename()
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Mi set' } })
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.name).toBe('Mi set')
    expect(screen.getByTestId('cue-flow-name')).toHaveValue('Mi set')
    fireEvent.blur(screen.getByTestId('cue-flow-name'))
    openAdd()
    fireEvent.click(screen.getByTestId('cue-flow-new'))
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Otro' } })
    expect(screen.getByTestId('cue-flow-name')).toHaveValue('Otro')
    expect(last?.cueFlows.at(-1)?.name).toBe('Otro')
  })

  it('lets the DJ edit the name Mi flujo shows instead of an unselectable placeholder, and an emptied name falls back', () => {
    render(<Harness />)
    startRename()
    const input = screen.getByTestId('cue-flow-name')
    expect(input).toHaveValue('My flow')
    fireEvent.change(input, { target: { value: 'Mi flujo 2' } })
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.name).toBe('Mi flujo 2')
    fireEvent.change(input, { target: { value: '' } })
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.name).toBe('')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'My flow')
    fireEvent.blur(input)
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('My flow')
  })

  it('restores the name of the bundled flow with Restablecer', () => {
    render(<Harness flows={BUNDLED_FLOWS} active="mix-in" />)
    startRename()
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Otro' } })
    fireEvent.blur(screen.getByTestId('cue-flow-name'))
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-restore'))
    expect(last?.cueFlows.find((f) => f.id === 'mix-in')?.name).toBe('')
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Mix in 64')
  })

  it('ends a rename on Escape without closing Settings, keeping what was typed', () => {
    const settingsEscape = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', settingsEscape)
    afterTest = () => window.removeEventListener('keydown', settingsEscape)
    render(<Harness />)
    startRename()
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Mi set' } })
    fireEvent.keyDown(screen.getByTestId('cue-flow-name'), { key: 'Escape' })
    expect(settingsEscape).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cue-flow-name')).toBeNull()
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Mi set')
  })

  it('never offers to delete a bundled flow but restores it as Surco ships it', () => {
    render(<Harness flows={BUNDLED_FLOWS} active="mix-in" />)
    openMore()
    expect(screen.queryByTestId('cue-flow-delete')).toBeNull()
    openMore()
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    fireEvent.click(screen.getByTestId('cue-rule-0-bars-option-8'))
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-restore'))
    expect(last?.cueFlows).toEqual([MIX_IN, MIX_IN_32])
    pick('mix-in-32')
    openMore()
    expect(screen.queryByTestId('cue-flow-delete')).toBeNull()
    openMore()
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    fireEvent.click(screen.getByTestId('cue-rule-0-bars-option-4'))
    expect(last?.cueFlows[1].rules[0].bars).toBe(4)
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-restore'))
    expect(last?.cueFlows).toEqual([MIX_IN, MIX_IN_32])
  })

  it('treats the Mi flujo an earlier Surco kept as a flow of the DJ, deletable and with nothing to restore', () => {
    render(<Harness />)
    openMore()
    expect(screen.queryByTestId('cue-flow-restore')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-flow-delete'))
    expect(last?.cueFlows.map((f) => f.id)).toEqual(['mix-in', 'one-at-32', 'calls-only'])
    expect(last?.activeCueFlow).toBe('mix-in')
    openPicker()
    expect(screen.getByTestId('cue-flow-mix-in')).toHaveAttribute('aria-checked', 'true')
  })

  it('deletes another flow and falls back to the bundled flow when it was the default', () => {
    render(<Harness active="calls-only" />)
    pick('calls-only')
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-delete'))
    expect(last?.cueFlows.map((f) => f.id)).toEqual(['mix-in', 'mine', 'one-at-32'])
    expect(last?.activeCueFlow).toBe('mix-in')
  })

  it('reads each rule as one sentence, the way the DJ would say it', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    expect(screen.getByTestId('cue-rule-0')).toHaveTextContent(
      'Desde donde marcas, hacia atrás, cada 16 compases, 3 veces, si cabe, pon hot cue + CALL',
    )
    expect(screen.getByTestId('cue-rule-1')).toHaveTextContent(
      'Desde el primer golpe de la pista, en el mismo golpe, si no hay otra antes de donde marcas, pon hot cue + CALL',
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

  it('sets the quantize of the manual editor in the same card, the bar by default', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    const card = screen.getByTestId('cue-manual')
    expect(within(card).getByTestId('cue-quantize-bar')).toHaveTextContent('Compás')
    expect(within(card).getByTestId('cue-quantize-bar')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(card).getByTestId('cue-quantize-beat'))
    expect(last?.cueQuantize).toBe('beat')
    expect(screen.getByTestId('cue-quantize-beat')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cue-quantize-beat')).toHaveTextContent('Golpe')
  })

  describe('Aprender de mi colección', () => {
    const LEARNED: LearnedFlow = {
      flow: { id: 'learned', name: '', markPoint: true, rules: ONE_AT_32.rules },
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
      openAdd()
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
      openAdd()
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(screen.getByTestId('cue-learn-spinner')).toBeInTheDocument()
      openAdd()
      expect(screen.getByTestId('cue-learn')).toBeDisabled()
      await act(async () => finish(LEARNED))
      expect(screen.queryByTestId('cue-learn-spinner')).toBeNull()
      const proposal = screen.getByTestId('cue-learned')
      expect(proposal).toHaveTextContent('Aprendido de mi colección')
      expect(proposal).toHaveTextContent('Encaja con 18 de 20 pistas')
      expect(within(proposal).getByTestId('cue-flow-preview')).toBeInTheDocument()
      expect(last?.cueFlows).toEqual(KEPT)
      expect(last?.activeCueFlow).toBe('mine')
    })

    it('saves the proposal as a new default flow only on "Poner por defecto"', async () => {
      await i18n.changeLanguage('es')
      afterTest = () => i18n.changeLanguage('en')
      learnable(Promise.resolve(LEARNED))
      openAdd()
      fireEvent.click(screen.getByTestId('cue-learn'))
      fireEvent.click(await screen.findByTestId('cue-learned-use'))
      const made = last?.cueFlows.find((f) => !KEPT.some((b) => b.id === f.id))
      expect(made).toEqual({
        id: expect.any(String),
        name: 'Aprendido de mi colección',
        markPoint: true,
        rules: ONE_AT_32.rules,
      })
      expect(made?.id).not.toBe('learned')
      expect(last?.cueFlows.slice(0, KEPT.length)).toEqual(KEPT)
      expect(last?.activeCueFlow).toBe(made?.id)
      expect(screen.queryByTestId('cue-learned')).toBeNull()
    })

    it('says pista in the singular when a single track is marked', async () => {
      await i18n.changeLanguage('es')
      afterTest = () => i18n.changeLanguage('en')
      learnable(Promise.resolve({ ...LEARNED, coverage: { matching: 1, marked: 1 } }))
      openAdd()
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(await screen.findByTestId('cue-learned-coverage')).toHaveTextContent(
        'Encaja con 1 de 1 pista',
      )
      expect(screen.getByTestId('cue-learned-coverage')).not.toHaveTextContent('pistas')
    })

    it('discards the proposal without touching the flows', async () => {
      learnable(Promise.resolve(LEARNED))
      openAdd()
      fireEvent.click(screen.getByTestId('cue-learn'))
      fireEvent.click(await screen.findByTestId('cue-learned-discard'))
      expect(screen.queryByTestId('cue-learned')).toBeNull()
      expect(last?.cueFlows).toEqual(KEPT)
      expect(last?.activeCueFlow).toBe('mine')
    })

    it('says the collection has no clear pattern when nothing is learned', async () => {
      await i18n.changeLanguage('es')
      afterTest = () => i18n.changeLanguage('en')
      learnable(Promise.resolve(null))
      openAdd()
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(await screen.findByTestId('cue-learn-none')).toHaveTextContent(
        'Tu colección no tiene un patrón claro',
      )
      expect(last?.cueFlows).toEqual(KEPT)
    })

    it('drops a result that arrives after the DJ moved to another flow and keeps the button busy until it does', async () => {
      let finish: (value: LearnedFlow | null) => void = () => {}
      const rekordboxLearnFlow = learnable(
        new Promise((done) => {
          finish = done
        }),
      )
      openAdd()
      fireEvent.click(screen.getByTestId('cue-learn'))
      pick('one-at-32')
      openAdd()
      expect(screen.getByTestId('cue-learn')).toBeDisabled()
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(rekordboxLearnFlow).toHaveBeenCalledTimes(1)
      await act(async () => finish(LEARNED))
      expect(screen.queryByTestId('cue-learned')).toBeNull()
      expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('One cue at 32')
      expect(screen.getByTestId('cue-learn')).toBeEnabled()
    })

    it('says the collection could not be read instead of spinning forever', async () => {
      learnable(Promise.reject(new Error('locked')))
      openAdd()
      fireEvent.click(screen.getByTestId('cue-learn'))
      expect(await screen.findByTestId('cue-learn-failed')).toBeInTheDocument()
      expect(screen.queryByTestId('cue-learn-spinner')).toBeNull()
    })
  })
})
