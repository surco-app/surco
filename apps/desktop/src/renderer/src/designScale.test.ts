import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('.', import.meta.url))
const sources = (readdirSync(root, { recursive: true }) as string[])
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .map((f) => f.split('\\').join('/'))

function offenders(pattern: RegExp, allowed: (match: string) => boolean): string[] {
  return sources.flatMap((file) =>
    [...readFileSync(join(root, file), 'utf8').matchAll(pattern)]
      .map((m) => m[0])
      .filter((m) => !allowed(m))
      .map((m) => `${file}: ${m}`),
  )
}

describe('a disabled control looks the same on every screen, so «not yet» reads at a glance', () => {
  it('dims every disabled control to 40%', () => {
    expect(offenders(/disabled:opacity-\d+/g, (m) => m === 'disabled:opacity-40')).toEqual([])
  })
})

const TEXT_SIZE = /(?<![\w-])text-(xs|sm|base|lg|[2-9]?xl|label|section|figure|\[\d+(?:\.\d+)?px\])(?![\w-])/g
const TYPE_SCALE = new Set([
  'text-label',
  'text-xs',
  'text-section',
  'text-sm',
  'text-base',
  'text-xl',
  'text-figure',
])
const OVER_THE_WAVE = new Set(['components/CueWave.tsx', 'components/SpectrumGlimpse.tsx'])

describe('type comes in six sizes plus the big figure, each with one job, so hierarchy reads the same everywhere', () => {
  it('sizes every text from the scale', () => {
    expect(
      sources.flatMap((file) =>
        [...readFileSync(join(root, file), 'utf8').matchAll(TEXT_SIZE)]
          .map((m) => m[0])
          .filter((m) => !TYPE_SCALE.has(m) && !(m === 'text-[10px]' && OVER_THE_WAVE.has(file)))
          .map((m) => `${file}: ${m}`),
      ),
    ).toEqual([])
  })

  it('emphasises with semibold at most', () => {
    expect(offenders(/(?<![\w-])font-bold(?![\w-])/g, () => false)).toEqual([])
  })
})
