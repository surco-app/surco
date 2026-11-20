import { Check, Minus } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type CueRule,
  FLOW_ORIGINS,
  FLOW_PLACES,
  FLOW_SECTIONS,
  type FlowColor,
  type FlowCondition,
  type FlowDirection,
  type FlowRepeat,
  fitWhenEach,
  formatRepeatWhen,
  MAX_RULE_REPEAT,
  NEAR_BARS,
  type RepeatWhen,
  ROOM_GAP,
  RULE_BARS,
  repeatWhenOf,
  withRepeatWhen,
} from '../../../shared/cueFlows'
import { HOT_CUE_DEFAULT_INDEX, hotCueColor } from '../../../shared/rekordboxCueColors'
import { CuePalette } from './CuePalette'
import { Tooltip } from './Tooltip'

const REPEATS = [1, 2, 3, 4, 5, 6, 7, 8]
const DIRECTIONS: FlowDirection[] = ['back', 'forward']
const COLOR_MODES = ['fixed', 'each'] as const

type Block = 'from' | 'direction' | 'bars' | 'repeat' | 'when' | 'gap' | 'place' | 'color-mode'

const BLOCK_LABEL: Record<Block, string> = {
  from: 'from',
  direction: 'direction',
  bars: 'bars',
  repeat: 'repeat',
  when: 'when',
  gap: 'gap',
  place: 'place',
  'color-mode': 'colorMode',
}

const TOKEN_CLASS =
  'press rounded-[3px] leading-6 text-[var(--color-accent)] underline decoration-[var(--color-accent)]/50 decoration-dotted underline-offset-4 hover:decoration-solid aria-expanded:decoration-solid'
const MENU_CLASS =
  'absolute z-20 overflow-y-auto rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-xs leading-normal shadow-[var(--shadow-float)]'
const ITEM_CLASS =
  'block w-full whitespace-nowrap px-3 py-1 text-left hover:bg-[var(--color-hover)] aria-checked:font-semibold aria-checked:text-fg'
const BOX_CLASS =
  'press flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap rounded-[3px] px-1 py-1 text-left text-xs leading-normal hover:bg-[var(--color-hover)] aria-checked:text-fg'
const SECTION_CLASS =
  'press grow rounded-[3px] px-1 py-1 text-center text-xs leading-normal whitespace-nowrap text-fg-muted hover:bg-[var(--color-hover)] aria-checked:bg-[var(--color-panel-2)] aria-checked:text-fg'
const NEAR_DEFAULT = { before: 32, after: 16 }
type NearSide = keyof typeof NEAR_DEFAULT

function conditionsFor(rule: CueRule): FlowCondition[] {
  const offered: FlowCondition[] =
    rule.bars === 0
      ? ['always', 'room', 'clear', 'first']
      : rule.from === 'drop' && rule.direction === 'back'
        ? ['fits', 'previous', 'always', 'room', 'clear']
        : ['fits', 'always', 'room', 'clear']
  return offered.includes(rule.when) ? offered : [...offered, rule.when]
}

function withCondition(rule: CueRule, when: FlowCondition): CueRule {
  const { gap, ...rest } = rule
  return when === 'room' ? { ...rest, when, gap: gap ?? ROOM_GAP } : { ...rest, when }
}

function slotCount(rule: CueRule): number {
  if ('fixed' in rule.color) return 1
  return rule.repeat === 'edge' ? 3 : Math.min(rule.repeat, MAX_RULE_REPEAT, 8)
}

export const MENU_GAP = 4

export function clipBox(el: HTMLElement): {
  top: number
  right: number
  bottom: number
  scroller: HTMLElement | null
} {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) {
      const { top, left, right, bottom } = node.getBoundingClientRect()
      const inner = node.clientWidth > 0 ? left + node.clientLeft + node.clientWidth : right
      return { top, right: inner, bottom, scroller: node }
    }
  }
  return { top: 0, right: window.innerWidth, bottom: window.innerHeight, scroller: null }
}

function colorAt(color: FlowColor, slot: number): number {
  if ('fixed' in color) return color.fixed
  return color.each[slot] ?? color.each[color.each.length - 1] ?? 1
}

export interface RuleReorder {
  dragged: number | null
  onArm: (index: number | null) => void
  onMove: (from: number, to: number) => void
}

export function CueRuleRow({
  rule,
  index,
  onChange,
  onRemove,
  reorder,
}: {
  rule: CueRule
  index: number
  onChange: (rule: CueRule) => void
  onRemove: () => void
  reorder?: RuleReorder
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const [open, setOpen] = useState<string | null>(null)
  const rowRef = useRef<HTMLFieldSetElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const [paletteRight, setPaletteRight] = useState(false)
  const [menuUp, setMenuUp] = useState(false)
  const [dropHere, setDropHere] = useState(false)
  const dragged = reorder?.dragged ?? null
  const id = `cue-rule-${index}`
  const slots = slotCount(rule)
  const slotNumbers = Array.from({ length: slots }, (_, i) => i)
  const shownSlots = rule.direction === 'back' ? [...slotNumbers].reverse() : slotNumbers
  const showDistance = !('fixed' in rule.color)
  const shared = rule.bars === 0 || !showDistance
  const [nearBars, setNearBars] = useState<Record<string, number>>({})
  const whenAt = (slot: number): RepeatWhen => repeatWhenOf(rule, slot + 1)
  const own = (slot: number): boolean => formatRepeatWhen(whenAt(slot)) !== 'rule'
  const list = (items: string[], type: 'conjunction' | 'disjunction'): string =>
    new Intl.ListFormat(i18n.language, { type }).format(items)
  const conditionsOf = (when: RepeatWhen): string =>
    list(
      [
        ...(when.fits ? [tr('settings.cueFlows.whenEach.fits')] : []),
        ...(['before', 'after'] as const).flatMap((side) =>
          when[side] === null
            ? []
            : [tr(`settings.cueFlows.whenEach.${side}`, { count: when[side], bars: when[side] })],
        ),
        ...(when.sections.length === 0
          ? []
          : [
              tr('settings.cueFlows.whenEach.in', {
                sections: list(
                  when.sections.map((s) => tr(`settings.cueFlows.inSection.${s}`)),
                  'disjunction',
                ),
              }),
            ]),
      ],
      'conjunction',
    )
  useEffect(() => {
    if (open === null) return
    const onDown = (e: MouseEvent) => {
      if (!paletteRef.current?.parentElement?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useLayoutEffect(() => {
    const palette = paletteRef.current
    const anchor = palette?.parentElement
    if (!open || !palette || !anchor) return
    const popping = palette.getBoundingClientRect()
    const width = (palette.offsetWidth || popping.width) + 1
    const height = (palette.offsetHeight || popping.height) + MENU_GAP
    const at = anchor.getBoundingClientRect()
    const clip = clipBox(palette)
    setPaletteRight(at.left + width > clip.right)
    const below = at.bottom + height - clip.bottom
    const fitsAbove = at.top - height >= clip.top
    setMenuUp(below > 0 && fitsAbove)
    if (below > 0 && !fitsAbove && clip.scroller) clip.scroller.scrollTop += Math.ceil(below)
  }, [open])

  const closeToToken = () => {
    const token = rowRef.current?.querySelector<HTMLElement>(`[data-testid="${id}-${open}"]`)
    setOpen(null)
    token?.focus()
  }

  const pickColor = (slot: number, color: number) => {
    if ('fixed' in rule.color) {
      onChange({ ...rule, color: { fixed: color } })
    } else {
      const each = Array.from({ length: slots }, (_, i) => colorAt(rule.color, i))
      each[slot] = color
      onChange({ ...rule, color: { each } })
    }
    closeToToken()
  }

  const setWhen = (slot: number, change: Partial<RepeatWhen>) =>
    onChange(withRepeatWhen(rule, slot, { ...whenAt(slot), ...change }))

  const nearBarsAt = (slot: number, side: NearSide): number =>
    whenAt(slot)[side] ?? nearBars[`${slot}-${side}`] ?? NEAR_DEFAULT[side]

  const setNear = (slot: number, side: NearSide, bars: number, on: boolean) => {
    setNearBars({ ...nearBars, [`${slot}-${side}`]: bars })
    if (on || whenAt(slot)[side] !== null) setWhen(slot, { [side]: on ? bars : null })
  }

  const toggleSection = (slot: number, section: RepeatWhen['sections'][number]) => {
    const { sections } = whenAt(slot)
    setWhen(slot, {
      sections: sections.includes(section)
        ? sections.filter((s) => s !== section)
        : [...sections, section],
    })
  }

  const setColorMode = (mode: (typeof COLOR_MODES)[number]) => {
    const words = slotNumbers.map((slot) => formatRepeatWhen(whenAt(slot)))
    if (mode === 'each') {
      const first = colorAt(rule.color, 0)
      const next = { ...rule, color: { each: Array.from({ length: 3 }, () => first) } }
      onChange(
        fitWhenEach(
          next,
          Array.from({ length: slotCount(next) }, () => words[0]),
        ),
      )
    } else {
      const same = words.every((w) => w === words[0])
      onChange(
        fitWhenEach({ ...rule, color: { fixed: colorAt(rule.color, 0) } }, same ? [words[0]] : []),
      )
    }
  }

  const box = (
    slot: number,
    name: string,
    checked: boolean,
    label: string,
    toggle: () => void,
    full?: string,
  ): React.JSX.Element => (
    <button
      key={name}
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-label={full}
      data-testid={`${id}-color-${slot}-when-${name}`}
      onClick={toggle}
      className={BOX_CLASS}
    >
      <Check className={`h-3.5 w-3.5 shrink-0 ${checked ? '' : 'invisible'}`} aria-hidden="true" />
      {label}
      {full && <Tooltip label={full} />}
    </button>
  )

  const nearBox = (slot: number, side: NearSide): React.JSX.Element => {
    const on = whenAt(slot)[side] !== null
    const label = tr(`settings.cueFlows.whenEach.${side}Any`)
    return (
      <div className="flex items-center gap-2">
        {box(
          slot,
          side,
          on,
          tr(`settings.cueFlows.whenEach.${side}Short`),
          () => setNear(slot, side, nearBarsAt(slot, side), !on),
          label,
        )}
        <select
          data-testid={`${id}-color-${slot}-when-${side}-bars`}
          aria-label={label}
          value={nearBarsAt(slot, side)}
          onChange={(e) => setNear(slot, side, Number(e.target.value), on)}
          className="h-5 shrink-0 rounded-[3px] border border-[var(--color-line)] bg-[var(--color-field)] px-1 text-xs tabular-nums text-fg"
        >
          {NEAR_BARS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const barsLabel = (bars: number): string =>
    bars === 0 ? tr('settings.cueFlows.barsZero') : tr('settings.cueFlows.bars', { count: bars })
  const repeatLabel = (repeat: FlowRepeat): string =>
    repeat === 'edge'
      ? tr('settings.cueFlows.repeatEdge')
      : tr('settings.cueFlows.repeat', { count: repeat })

  const token = <T extends string | number>(
    block: Block,
    options: { value: T; label: string; hint?: string }[],
    current: T,
    label: string,
    pick: (value: T) => void,
  ): React.JSX.Element => (
    <span className="relative">
      <button
        type="button"
        data-testid={`${id}-${block}`}
        aria-label={tr(`settings.cueFlows.block.${BLOCK_LABEL[block]}`)}
        aria-haspopup="menu"
        aria-expanded={open === block}
        onClick={() => setOpen(open === block ? null : block)}
        className={TOKEN_CLASS}
      >
        {label}
      </button>
      {open === block && (
        <div
          ref={paletteRef}
          role="menu"
          data-testid={`${id}-${block}-menu`}
          data-align={paletteRight ? 'right' : 'left'}
          data-side={menuUp ? 'top' : 'bottom'}
          className={`${MENU_CLASS} animate-pop-flat ${menuUp ? (paletteRight ? 'origin-bottom-right' : 'origin-bottom-left') : paletteRight ? 'origin-top-right' : 'origin-top-left'} ${paletteRight ? 'right-0' : 'left-0'} ${menuUp ? 'bottom-full mb-1' : 'top-full mt-1'} ${options.some((o) => o.hint) ? 'max-h-96 w-72' : 'max-h-64'}`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === current}
              data-testid={`${id}-${block}-option-${o.value}`}
              onClick={() => {
                pick(o.value)
                closeToToken()
              }}
              className={ITEM_CLASS}
            >
              {o.label}
              {o.hint && (
                <span
                  data-testid={`${id}-${block}-option-${o.value}-hint`}
                  className="block whitespace-normal font-normal text-label text-fg-dim"
                >
                  {o.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  )

  return (
    <fieldset
      ref={rowRef}
      data-testid={id}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || open === null) return
        e.stopPropagation()
        closeToToken()
      }}
      draggable={dragged === index}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(index))
      }}
      onDragOver={(e) => {
        if (dragged === null || dragged === index) return
        e.preventDefault()
        setDropHere(true)
      }}
      onDragLeave={() => setDropHere(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropHere(false)
        if (dragged !== null) reorder?.onMove(dragged, index)
        reorder?.onArm(null)
      }}
      onDragEnd={() => reorder?.onArm(null)}
      onMouseUp={() => reorder?.onArm(null)}
      className={`relative m-0 min-w-0 py-2 pr-10 pl-3.5 text-sm leading-8 text-fg-dim ${dropHere ? 'bg-[var(--color-accent-soft)]' : ''} ${dragged === index ? 'opacity-40' : ''}`}
    >
      {reorder ? (
        <button
          type="button"
          data-testid={`${id}-move`}
          aria-label={tr('settings.cueFlows.moveRule', { n: index + 1 })}
          onMouseDown={() => reorder.onArm(index)}
          onKeyDown={(e) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
            e.preventDefault()
            reorder.onMove(index, index + (e.key === 'ArrowUp' ? -1 : 1))
          }}
          className="press relative mr-2 cursor-grab rounded-[3px] font-mono text-xs text-fg-faint hover:text-fg"
        >
          {index + 1}
          <Tooltip label={tr('settings.cueFlows.moveRuleHint')} />
        </button>
      ) : (
        <span aria-hidden="true" className="mr-2 font-mono text-xs text-fg-faint">
          {index + 1}
        </span>
      )}
      {token(
        'from',
        FLOW_ORIGINS.map((o) => ({ value: o, label: tr(`settings.cueFlows.from.${o}`) })),
        rule.from,
        tr(`settings.cueFlows.from.${rule.from}`),
        (from) => onChange({ ...rule, from }),
      )}
      {rule.bars > 0 && (
        <>
          {', '}
          {token(
            'direction',
            DIRECTIONS.map((d) => ({ value: d, label: tr(`settings.cueFlows.direction.${d}`) })),
            rule.direction,
            tr(`settings.cueFlows.direction.${rule.direction}`),
            (direction) => onChange({ ...rule, direction }),
          )}
        </>
      )}
      {', '}
      {rule.bars > 0 && `${tr('settings.cueFlows.sentence.every')} `}
      {token(
        'bars',
        RULE_BARS.map((b) => ({ value: b, label: barsLabel(b) })),
        rule.bars,
        barsLabel(rule.bars),
        (bars) =>
          onChange(fitWhenEach(bars === 0 ? { ...rule, bars, repeat: 1 } : { ...rule, bars })),
      )}
      {rule.bars > 0 && (
        <>
          {', '}
          {token<FlowRepeat>(
            'repeat',
            [...REPEATS, 'edge' as const].map((r) => ({ value: r, label: repeatLabel(r) })),
            rule.repeat,
            repeatLabel(rule.repeat),
            (repeat) => onChange(fitWhenEach({ ...rule, repeat })),
          )}
        </>
      )}
      {', '}
      {token(
        'when',
        conditionsFor(rule).map((w) => ({
          value: w,
          label: tr(`settings.cueFlows.when.${w}`),
          hint: tr(`settings.cueFlows.whenHint.${w}`),
        })),
        rule.when,
        rule.when === 'room'
          ? tr('settings.cueFlows.sentence.roomLead')
          : tr(`settings.cueFlows.when.${rule.when}`),
        (when) => onChange(withCondition(rule, when)),
      )}
      {rule.when === 'room' && (
        <>
          {' '}
          {token(
            'gap',
            RULE_BARS.filter((b) => b > 0).map((b) => ({ value: b, label: barsLabel(b) })),
            rule.gap ?? ROOM_GAP,
            tr('settings.cueFlows.sentence.roomBars', { count: rule.gap ?? ROOM_GAP }),
            (gap) => onChange({ ...rule, gap }),
          )}
          {tr('settings.cueFlows.sentence.roomAfter')}
        </>
      )}
      {`, ${tr('settings.cueFlows.sentence.put')} `}
      {token(
        'place',
        FLOW_PLACES.map((p) => ({ value: p, label: tr(`settings.cueFlows.place.${p}`) })),
        rule.place,
        tr(`settings.cueFlows.place.${rule.place}`),
        (place) => onChange({ ...rule, place }),
      )}
      {rule.place !== 'call' && (
        <>
          {' '}
          <span className="whitespace-nowrap">
            {token(
              'color-mode',
              COLOR_MODES.map((m) => ({ value: m, label: tr(`settings.cueFlows.colorMode.${m}`) })),
              'fixed' in rule.color ? 'fixed' : 'each',
              tr(`settings.cueFlows.colorMode.${'fixed' in rule.color ? 'fixed' : 'each'}`),
              setColorMode,
            )}{' '}
            <span className="inline-flex items-start gap-1 align-middle">
              {shownSlots.map((slot) => (
                <span key={slot} className="relative flex">
                  {/* The distance sits inside its square, in black as on the wave's cue marks so
                    it reads on every colour: under it, the numbers made the row taller than the
                    sentence and set the squares off the line of text. */}
                  <button
                    type="button"
                    data-testid={`${id}-color-${slot}`}
                    aria-label={tr('settings.cueFlows.block.color', { n: slot + 1 })}
                    aria-expanded={open === `color-${slot}`}
                    data-own={own(slot) ? 'true' : undefined}
                    onClick={() => setOpen(open === `color-${slot}` ? null : `color-${slot}`)}
                    style={
                      own(slot)
                        ? ({
                            backgroundColor: 'transparent',
                            '--cue': hotCueColor(colorAt(rule.color, slot)),
                          } as React.CSSProperties)
                        : {
                            backgroundColor: hotCueColor(colorAt(rule.color, slot)),
                            color: '#000',
                          }
                    }
                    className={`press flex h-[20px] min-w-[20px] items-center justify-center rounded-[3px] px-1 ${own(slot) ? 'border-2 border-[color:color-mix(in_srgb,var(--cue)_75%,var(--color-fg))] text-fg' : 'border border-[var(--color-line)]'}`}
                  >
                    {showDistance && (
                      <span
                        data-testid={`${id}-color-${slot}-distance`}
                        className="text-label leading-none font-semibold tabular-nums"
                      >
                        {rule.bars * (slot + 1)}
                      </span>
                    )}
                  </button>
                  {open === `color-${slot}` && (
                    <div
                      ref={paletteRef}
                      data-testid={`${id}-color-${slot}-palette`}
                      data-align={paletteRight ? 'right' : 'left'}
                      data-side={menuUp ? 'top' : 'bottom'}
                      className={`animate-pop-flat absolute ${menuUp ? (paletteRight ? 'origin-bottom-right' : 'origin-bottom-left') : paletteRight ? 'origin-top-right' : 'origin-top-left'} ${paletteRight ? 'right-0' : 'left-0'} ${menuUp ? 'bottom-full mb-1' : 'top-full mt-1'} z-20 w-72 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-2 shadow-[var(--shadow-float)]`}
                    >
                      <CuePalette
                        value={colorAt(rule.color, slot)}
                        onPick={(color) => pickColor(slot, color)}
                        label={(i) => tr('editor.cues.colour', { index: i })}
                        wide
                      />
                      <div className="my-1 h-px bg-[var(--color-line)]" />
                      <div className="flex items-center gap-2">
                        {box(
                          slot,
                          'fits',
                          whenAt(slot).fits,
                          tr('settings.cueFlows.whenEach.fits'),
                          () => setWhen(slot, { fits: !whenAt(slot).fits }),
                        )}
                        <button
                          type="button"
                          data-testid="cue-palette-reset"
                          onClick={() => pickColor(slot, HOT_CUE_DEFAULT_INDEX)}
                          className="press shrink-0 rounded-md px-2 py-0.5 text-xs text-fg-dim hover:text-fg"
                        >
                          {tr('editor.cues.resetColour')}
                        </button>
                      </div>
                      {nearBox(slot, 'before')}
                      {nearBox(slot, 'after')}
                      <div className="my-1 h-px bg-[var(--color-line)]" />
                      <p
                        data-testid={`${id}-color-${slot}-when-only`}
                        className="px-1 text-label leading-normal text-fg-faint"
                      >
                        {tr('settings.cueFlows.whenEach.only')}
                      </p>
                      <div
                        data-testid={`${id}-color-${slot}-when-sections`}
                        className="flex flex-wrap gap-0.5"
                      >
                        {FLOW_SECTIONS.map((section) => (
                          <button
                            key={section}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={whenAt(slot).sections.includes(section)}
                            data-testid={`${id}-color-${slot}-when-in-${section}`}
                            onClick={() => toggleSection(slot, section)}
                            className={SECTION_CLASS}
                          >
                            {tr(`settings.cueFlows.section.${section}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </span>
              ))}
            </span>
          </span>
        </>
      )}
      <button
        type="button"
        data-testid={`${id}-remove`}
        aria-label={tr('settings.cueFlows.removeRule')}
        onClick={onRemove}
        className="press absolute top-2.5 right-2 rounded-full p-1 text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
      >
        <Minus size={14} />
      </button>
      <p data-testid={`${id}-when-line`} className="text-xs leading-normal text-fg-faint">
        {tr(`settings.cueFlows.whenHint.${rule.when}`)}
        {shownSlots.filter(own).map((slot, i) => (
          <span key={slot}>
            {i === 0 ? tr('settings.cueFlows.whenEachLead') : ' '}
            {shared
              ? tr('settings.cueFlows.whenEach.lineAll', { conditions: conditionsOf(whenAt(slot)) })
              : tr('settings.cueFlows.whenEach.line', {
                  bars: rule.bars * (slot + 1),
                  conditions: conditionsOf(whenAt(slot)),
                })}
          </span>
        ))}
      </p>
      {rule.place === 'call' && (
        <p data-testid={`${id}-loose-call`} className="text-label leading-normal text-fg-dim">
          {tr('settings.cueFlows.looseCall')}
        </p>
      )}
    </fieldset>
  )
}
