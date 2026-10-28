import { Minus } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type CueRule,
  FLOW_CONDITIONS,
  FLOW_ORIGINS,
  FLOW_PLACES,
  type FlowColor,
  type FlowDirection,
  type FlowRepeat,
  MAX_RULE_REPEAT,
  RULE_BARS,
} from '../../../shared/cueFlows'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import { CuePalette } from './CuePalette'

const REPEATS = [1, 2, 3, 4, 5, 6, 7, 8]
const DIRECTIONS: FlowDirection[] = ['back', 'forward']
const COLOR_MODES = ['fixed', 'each'] as const

type Block = 'from' | 'direction' | 'bars' | 'repeat' | 'when' | 'place' | 'color-mode'

const BLOCK_LABEL: Record<Block, string> = {
  from: 'from',
  direction: 'direction',
  bars: 'bars',
  repeat: 'repeat',
  when: 'when',
  place: 'place',
  'color-mode': 'colorMode',
}

const TOKEN_CLASS =
  'press rounded-[3px] leading-6 text-[var(--color-accent)] underline decoration-[var(--color-accent)]/50 decoration-dotted underline-offset-4 hover:decoration-solid aria-expanded:decoration-solid'
const MENU_CLASS =
  'absolute left-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-xs leading-normal shadow-[var(--shadow-float)]'
const ITEM_CLASS =
  'block w-full whitespace-nowrap px-3 py-1 text-left hover:bg-[var(--color-hover)] aria-checked:font-semibold aria-checked:text-fg'

function slotCount(rule: CueRule): number {
  if ('fixed' in rule.color) return 1
  return rule.repeat === 'edge' ? 3 : Math.min(rule.repeat, MAX_RULE_REPEAT, 8)
}

function clipRight(el: HTMLElement): number {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`))
      return node.getBoundingClientRect().right
  }
  return window.innerWidth
}

function colorAt(color: FlowColor, slot: number): number {
  if ('fixed' in color) return color.fixed
  return color.each[slot] ?? color.each[color.each.length - 1] ?? 1
}

export function CueRuleRow({
  rule,
  index,
  onChange,
  onRemove,
}: {
  rule: CueRule
  index: number
  onChange: (rule: CueRule) => void
  onRemove: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState<string | null>(null)
  const rowRef = useRef<HTMLFieldSetElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const [paletteRight, setPaletteRight] = useState(false)
  const id = `cue-rule-${index}`
  const slots = slotCount(rule)
  const slotNumbers = Array.from({ length: slots }, (_, i) => i)
  const shownSlots = rule.direction === 'back' ? [...slotNumbers].reverse() : slotNumbers
  const showDistance = !('fixed' in rule.color)
  useEffect(() => {
    if (open === null) return
    const onDown = (e: MouseEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useLayoutEffect(() => {
    const palette = paletteRef.current
    const anchor = palette?.parentElement
    if (!open || !palette || !anchor) return
    const width = palette.getBoundingClientRect().width
    setPaletteRight(anchor.getBoundingClientRect().left + width > clipRight(palette))
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

  const setColorMode = (mode: (typeof COLOR_MODES)[number]) => {
    if (mode === 'each') {
      const first = colorAt(rule.color, 0)
      onChange({ ...rule, color: { each: Array.from({ length: 3 }, () => first) } })
    } else {
      onChange({ ...rule, color: { fixed: colorAt(rule.color, 0) } })
    }
  }

  const barsLabel = (bars: number): string =>
    bars === 0 ? tr('settings.cueFlows.barsZero') : tr('settings.cueFlows.bars', { count: bars })
  const repeatLabel = (repeat: FlowRepeat): string =>
    repeat === 'edge'
      ? tr('settings.cueFlows.repeatEdge')
      : tr('settings.cueFlows.repeat', { count: repeat })

  const token = <T extends string | number>(
    block: Block,
    options: { value: T; label: string }[],
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
        <div role="menu" data-testid={`${id}-${block}-menu`} className={MENU_CLASS}>
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
      className="relative m-0 min-w-0 py-2 pr-10 pl-3.5 text-sm leading-8 text-fg-dim"
    >
      <span aria-hidden="true" className="mr-2 font-mono text-xs text-fg-faint">
        {index + 1}
      </span>
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
        (bars) => onChange(bars === 0 ? { ...rule, bars, repeat: 1 } : { ...rule, bars }),
      )}
      {rule.bars > 0 && (
        <>
          {', '}
          {token<FlowRepeat>(
            'repeat',
            [...REPEATS, 'edge' as const].map((r) => ({ value: r, label: repeatLabel(r) })),
            rule.repeat,
            repeatLabel(rule.repeat),
            (repeat) => onChange({ ...rule, repeat }),
          )}
        </>
      )}
      {', '}
      {token(
        'when',
        FLOW_CONDITIONS.map((w) => ({ value: w, label: tr(`settings.cueFlows.when.${w}`) })),
        rule.when,
        tr(`settings.cueFlows.when.${rule.when}`),
        (when) => onChange({ ...rule, when }),
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
                    onClick={() => setOpen(open === `color-${slot}` ? null : `color-${slot}`)}
                    style={{
                      backgroundColor: hotCueColor(colorAt(rule.color, slot)),
                      color: '#000',
                    }}
                    className="press flex h-[20px] min-w-[20px] items-center justify-center rounded-[3px] border border-[var(--color-line)] px-1"
                  >
                    {showDistance && (
                      <span
                        data-testid={`${id}-color-${slot}-distance`}
                        className="text-[10px] leading-none font-semibold tabular-nums"
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
                      className={`absolute ${paletteRight ? 'right-0' : 'left-0'} top-full z-20 mt-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-2 shadow-[var(--shadow-float)]`}
                    >
                      <CuePalette
                        value={colorAt(rule.color, slot)}
                        onPick={(color) => pickColor(slot, color)}
                        label={(i) => tr('editor.cues.colour', { index: i })}
                      />
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
      {rule.place === 'call' && (
        <p data-testid={`${id}-loose-call`} className="text-[11px] leading-normal text-fg-dim">
          {tr('settings.cueFlows.looseCall')}
        </p>
      )}
    </fieldset>
  )
}
