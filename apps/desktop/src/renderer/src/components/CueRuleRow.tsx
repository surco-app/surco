import { X } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
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
const SELECT_CLASS =
  'rounded-md border border-[var(--color-line)] bg-[var(--color-field)] px-1.5 py-1 text-xs outline-none focus:border-[var(--color-accent)]'

function slotCount(rule: CueRule): number {
  if ('fixed' in rule.color) return 1
  return rule.repeat === 'edge' ? 3 : Math.min(rule.repeat, MAX_RULE_REPEAT, 8)
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
  const [openSlot, setOpenSlot] = useState<number | null>(null)
  const id = `cue-rule-${index}`
  const slots = slotCount(rule)
  const slotNumbers = Array.from({ length: slots }, (_, i) => i)

  const pickColor = (slot: number, color: number) => {
    if ('fixed' in rule.color) {
      onChange({ ...rule, color: { fixed: color } })
    } else {
      const each = Array.from({ length: slots }, (_, i) => colorAt(rule.color, i))
      each[slot] = color
      onChange({ ...rule, color: { each } })
    }
    setOpenSlot(null)
  }

  const setColorMode = (mode: string) => {
    if (mode === 'each') {
      const first = colorAt(rule.color, 0)
      onChange({ ...rule, color: { each: Array.from({ length: 3 }, () => first) } })
    } else {
      onChange({ ...rule, color: { fixed: colorAt(rule.color, 0) } })
    }
    setOpenSlot(null)
  }

  return (
    <div
      data-testid={id}
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--color-line)] px-2 py-1.5 text-xs"
    >
      <select
        data-testid={`${id}-from`}
        aria-label={tr('settings.cueFlows.block.from')}
        value={rule.from}
        onChange={(e) => onChange({ ...rule, from: e.target.value as CueRule['from'] })}
        className={SELECT_CLASS}
      >
        {FLOW_ORIGINS.map((o) => (
          <option key={o} value={o}>
            {tr(`settings.cueFlows.from.${o}`)}
          </option>
        ))}
      </select>
      <select
        data-testid={`${id}-bars`}
        aria-label={tr('settings.cueFlows.block.bars')}
        value={rule.bars}
        onChange={(e) => {
          const bars = Number(e.target.value)
          onChange(bars === 0 ? { ...rule, bars, repeat: 1 } : { ...rule, bars })
        }}
        className={SELECT_CLASS}
      >
        {RULE_BARS.map((b) => (
          <option key={b} value={b}>
            {b === 0
              ? tr('settings.cueFlows.barsZero')
              : tr('settings.cueFlows.bars', { count: b })}
          </option>
        ))}
      </select>
      {rule.bars > 0 && (
        <>
          <select
            data-testid={`${id}-direction`}
            aria-label={tr('settings.cueFlows.block.direction')}
            value={rule.direction}
            onChange={(e) => onChange({ ...rule, direction: e.target.value as FlowDirection })}
            className={SELECT_CLASS}
          >
            {(['back', 'forward'] as const).map((d) => (
              <option key={d} value={d}>
                {tr(`settings.cueFlows.direction.${d}`)}
              </option>
            ))}
          </select>
          <select
            data-testid={`${id}-repeat`}
            aria-label={tr('settings.cueFlows.block.repeat')}
            value={rule.repeat}
            onChange={(e) => {
              const repeat: FlowRepeat = e.target.value === 'edge' ? 'edge' : Number(e.target.value)
              onChange({ ...rule, repeat })
            }}
            className={SELECT_CLASS}
          >
            {REPEATS.map((r) => (
              <option key={r} value={r}>
                {tr('settings.cueFlows.repeat', { count: r })}
              </option>
            ))}
            <option value="edge">{tr('settings.cueFlows.repeatEdge')}</option>
          </select>
        </>
      )}
      <select
        data-testid={`${id}-when`}
        aria-label={tr('settings.cueFlows.block.when')}
        value={rule.when}
        onChange={(e) => onChange({ ...rule, when: e.target.value as CueRule['when'] })}
        className={SELECT_CLASS}
      >
        {FLOW_CONDITIONS.map((w) => (
          <option key={w} value={w}>
            {tr(`settings.cueFlows.when.${w}`)}
          </option>
        ))}
      </select>
      <select
        data-testid={`${id}-place`}
        aria-label={tr('settings.cueFlows.block.place')}
        value={rule.place}
        onChange={(e) => onChange({ ...rule, place: e.target.value as CueRule['place'] })}
        className={SELECT_CLASS}
      >
        {FLOW_PLACES.map((p) => (
          <option key={p} value={p}>
            {tr(`settings.cueFlows.place.${p}`)}
          </option>
        ))}
      </select>
      {rule.place !== 'call' && (
        <>
          <select
            data-testid={`${id}-color-mode`}
            aria-label={tr('settings.cueFlows.block.colorMode')}
            value={'fixed' in rule.color ? 'fixed' : 'each'}
            onChange={(e) => setColorMode(e.target.value)}
            className={SELECT_CLASS}
          >
            {(['fixed', 'each'] as const).map((m) => (
              <option key={m} value={m}>
                {tr(`settings.cueFlows.colorMode.${m}`)}
              </option>
            ))}
          </select>
          {slotNumbers.map((slot) => (
            <span key={slot} className="relative">
              <button
                type="button"
                data-testid={`${id}-color-${slot}`}
                aria-label={tr('settings.cueFlows.block.color', { n: slot + 1 })}
                aria-expanded={openSlot === slot}
                onClick={() => setOpenSlot(openSlot === slot ? null : slot)}
                style={{ backgroundColor: hotCueColor(colorAt(rule.color, slot)) }}
                className="press h-5 w-5 rounded-[3px] border border-[var(--color-line)]"
              />
              {openSlot === slot && (
                <div className="absolute left-0 top-full z-20 mt-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-2 shadow-[var(--shadow-float)]">
                  <CuePalette
                    value={colorAt(rule.color, slot)}
                    onPick={(color) => pickColor(slot, color)}
                    label={(i) => tr('editor.cues.colour', { index: i })}
                  />
                </div>
              )}
            </span>
          ))}
        </>
      )}
      <button
        type="button"
        data-testid={`${id}-remove`}
        aria-label={tr('settings.cueFlows.removeRule')}
        onClick={onRemove}
        className="press ml-auto rounded-md p-1 text-fg-dim hover:text-fg"
      >
        <X size={14} />
      </button>
      {rule.place === 'call' && (
        <p data-testid={`${id}-loose-call`} className="basis-full text-[11px] text-fg-dim">
          {tr('settings.cueFlows.looseCall')}
        </p>
      )}
    </div>
  )
}
