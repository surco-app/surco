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

const TEXT_SIZE =
  /(?<![\w-])text-(xs|sm|base|lg|[2-9]?xl|label|section|figure|\[\d+(?:\.\d+)?px\])(?![\w-])/g
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

const DURATIONS = new Set(['duration-120', 'duration-200', 'duration-240'])
const SEARCH_HIT_FADE = 'components/SettingsModal.tsx: duration-500'
const NOT_A_RESPONSE = [
  'spectrum-scan',
  'skeleton-sweep',
  'progress-sweep',
  'vinyl-spin',
  'donate-pop-in',
  'blocked-shake',
  'top-progress',
  'star-punch',
  'empty-disc-ping',
  'empty-disc-in',
  'empty-copy-in',
  'toast-countdown',
  'result-new',
  'allow-discrete',
  '--progress',
  'marquee-dist',
]

describe('everything that answers the user moves on one curve and three durations, so the app feels of a piece', () => {
  it('times every transition in the components from the three durations', () => {
    expect(
      offenders(/(?<![\w-])duration-(?:\d+|\[[^\]]+\])/g, (m) => DURATIONS.has(m)).filter(
        (m) => m !== SEARCH_HIT_FADE,
      ),
    ).toEqual([])
  })

  it('eases every transition in the components with the standard curve', () => {
    expect(
      offenders(/(?<![\w-])ease-(?:out|in-out|in|linear|\[[^\]]+\])(?![\w-])/g, () => false),
    ).toEqual([])
  })

  it('times and eases every responsive animation in the stylesheet from the tokens', () => {
    const css = readFileSync(join(root, 'index.css'), 'utf8')
    const literal = css
      .split('\n')
      .filter(
        (line) =>
          /^\s*(transition|animation)(-duration)?\s*:/.test(line) ||
          /^\s+[a-z-]+\s+[\d.]+m?s/.test(line),
      )
      .filter((line) =>
        /\d(?:\.\d+)?m?s\b|cubic-bezier|\bease\b/.test(line.replace(/var\([^)]*\)/g, '')),
      )
      .filter((line) => !NOT_A_RESPONSE.some((name) => line.includes(name)))
    expect(literal).toEqual([])
  })
})

describe('every window has the same 16 px corners, so a dialog reads as a window wherever it opens', () => {
  it('rounds every ModalShell panel with rounded-2xl', () => {
    const corners = sources.flatMap((file) =>
      [...readFileSync(join(root, file), 'utf8').matchAll(/<ModalShell\b[\s\S]*?>/g)].flatMap((m) =>
        [...m[0].matchAll(/(?<![\w-])rounded(?:-[a-z0-9]+)?(?![\w-])/g)]
          .map((r) => r[0])
          .filter((r) => r !== 'rounded-2xl')
          .map((r) => `${file}: ${r}`),
      ),
    )
    expect(corners).toEqual([])
  })
})

function openingTags(code: string, marker: string): string[] {
  const tags: string[] = []
  for (let at = code.indexOf(marker); at !== -1; at = code.indexOf(marker, at + 1)) {
    const open = code.lastIndexOf('<', at)
    let depth = 0
    let end = open
    for (; end < code.length; end++) {
      const ch = code[end]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    tags.push(code.slice(open, end + 1))
  }
  return tags
}

describe('a menu row is highlighted with corners parallel to its menu, so the two curves nest', () => {
  it('rounds every menu item with 4 px inside the 8 px menu and its 4 px inset', () => {
    const items = sources.flatMap((file) =>
      openingTags(readFileSync(join(root, file), 'utf8'), 'role="menuitem').flatMap((tag) =>
        [...tag.matchAll(/(?<![\w:-])rounded(?:-[a-z0-9]+)?(?![\w-])/g)]
          .map((r) => r[0])
          .filter((r) => r !== 'rounded')
          .map((r) => `${file}: ${r}`),
      ),
    )
    expect(items).toEqual([])
  })
})

const BARS = new Set(['components/Toolbar.tsx', 'components/TrackListHeader.tsx'])

function iconsLargerThanTheirText(code: string): string[] {
  const lines = code.split('\n')
  const found: string[] = []
  lines.forEach((line, i) => {
    const indent = line.length - line.trimStart().length
    if (!/^<[a-z]+\b/.test(line.trimStart())) return
    const tag = openingTags(code.slice(code.split('\n', i).join('\n').length), '<')[0] ?? ''
    if (tag.endsWith('/>') || !/(?<![\w:-])(text-label|text-xs)(?![\w-])/.test(tag)) return
    for (let j = i + tag.split('\n').length; j < lines.length; j++) {
      const child = lines[j]
      const at = child.length - child.trimStart().length
      if (child.trim() && at <= indent && !/^[{})]/.test(child.trimStart())) break
      const icon = /<([A-Z]\w+)\b[^>]*?className="[^"]*?\bh-(3\.5|4)\b/.exec(child)
      if (icon && at <= indent + 4) found.push(`${j + 1}: ${icon[1]} h-${icon[2]}`)
    }
  })
  return found
}

describe('an icon is as big as the text it sits beside, so neither shouts over the other', () => {
  it('keeps every line icon beside 11 or 12 px text at 12 px, outside the toolbars', () => {
    expect(
      sources
        .filter((file) => !BARS.has(file))
        .flatMap((file) =>
          iconsLargerThanTheirText(readFileSync(join(root, file), 'utf8')).map(
            (m) => `${file}:${m}`,
          ),
        ),
    ).toEqual([])
  })
})

const PRESS = /(?<![\w:-])press(?![\w-])/
const NOT_A_BUTTON_ROLE = /\brole="(?:menuitem\w*|option|tab)"/
const ROW_BUTTONS = new Set([
  'components/ActivityPanel.tsx: data-testid="activity-child"',
  'components/ActivityPanel.tsx: data-testid="activity-row"',
  'components/DiscogsPanel.tsx: data-testid="discogs-track"',
  'components/HelpModal.tsx: data-testid={`help-q-*`}',
  'components/PlaylistTree.tsx: data-testid="playlists-create"',
  'components/PlaylistTree.tsx: data-testid={`playlists-folder-*`}',
  'components/SectionHeader.tsx: onClick={onToggle}',
  'components/SourceTree.tsx: data-testid={`source-node-*`}',
  'components/TagListBulkField.tsx: data-testid={`*-per-track-toggle`}',
])
const FIELD_WIDE_TRIGGERS = new Set([
  'components/FilterBar.tsx: data-testid={`*-trigger`}',
  'components/PlaylistsField.tsx: data-testid="playlists-summary"',
  'components/Select.tsx: data-testid={testid}',
])
const HIGHLIGHT_PAINTED_ABOVE = new Set(['components/SegmentedControl.tsx: data-testid={`*-*`}'])
const ALREADY_TRANSFORMED = new Set([
  "components/CueWave.tsx: aria-label={t('cueWave.call', { time: formatTime(c.ms / 1000) })}",
  "components/CueWave.tsx: aria-label={t('cueWave.hotCue', { letter: h.letter })}",
  'components/DeclickSection.tsx: data-testid="declick-mark"',
  'components/FieldInsertMenu.tsx: data-testid={`field-insert-*`}',
  "components/TrackList.tsx: aria-label={tr('player.play')}",
  'components/TrackList.tsx: onClick={() => {',
])
const BACKDROPS = new Set([
  'components/FieldInsertMenu.tsx: data-testid="field-insert-backdrop"',
  'components/FilterBar.tsx: data-testid={`*-backdrop`}',
  'components/ModalShell.tsx: data-testid={backdropTestId}',
  'components/Select.tsx: data-testid={`*-backdrop`}',
  'components/SourceRail.tsx: data-testid="source-rail-menu-backdrop"',
  "components/SourceTree.tsx: aria-label={tr('common.close')}",
  'components/TrackContextMenu.tsx: data-testid="track-menu-backdrop"',
])
const COVER_AREAS = new Set([
  'components/CoverPicker.tsx: data-testid="cover-zoom"',
  'components/CoverPicker.tsx: data-testid="cover-pick"',
])
const WORDS_IN_A_SENTENCE = new Set([
  'components/ActivityPanel.tsx: onClick={() => openUrl(part)}',
  'components/ConvertFooter.tsx: data-testid="verify-open-originals"',
  "components/DiscogsPanel.tsx: onClick={() => onOpenSettings('search')}",
])
const UNPRESSED = [
  ROW_BUTTONS,
  FIELD_WIDE_TRIGGERS,
  HIGHLIGHT_PAINTED_ABOVE,
  ALREADY_TRANSFORMED,
  BACKDROPS,
  COVER_AREAS,
  WORDS_IN_A_SENTENCE,
]

const CLASS_STRING = /\bconst (\w+) =\s*(['"`])([\s\S]*?)\2/g
const EXPORTED_CLASS_STRING = /\bexport const (\w+) =\s*(['"`])([\s\S]*?)\2/g
const exportedClasses = new Map(
  (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .flatMap((f) => [...readFileSync(join(root, f), 'utf8').matchAll(EXPORTED_CLASS_STRING)])
    .map((m) => [m[1], m[3]]),
)

function carriesPress(text: string, local: Map<string, string>, seen = new Set<string>()): boolean {
  if (PRESS.test(text)) return true
  return [...text.matchAll(/\b[A-Za-z_]\w*\b/g)].some(([name]) => {
    if (seen.has(name)) return false
    seen.add(name)
    const value = local.get(name) ?? exportedClasses.get(name)
    return value !== undefined && carriesPress(value, local, seen)
  })
}

function buttonName(tag: string): string | undefined {
  return /\b(?:data-testid|aria-label|onClick)=(?:"[^"]*"|\{[^\n]*)/
    .exec(tag)?.[0]
    .replace(/\$\{[^}]*\}/g, '*')
}

describe('a button gives way the instant it is pressed, so the app answers on pointer-down instead of on release', () => {
  it('scales every compact button in the components with press, outside the listed rows, backdrops and transformed marks', () => {
    const unpressed = sources
      .filter((file) => file.startsWith('components/'))
      .flatMap((file) => {
        const code = readFileSync(join(root, file), 'utf8')
        const local = new Map([...code.matchAll(CLASS_STRING)].map((m) => [m[1], m[3]]))
        return openingTags(code, '<button')
          .filter((tag) => /^<button\s/.test(tag) && !NOT_A_BUTTON_ROLE.test(tag))
          .filter((tag) => !carriesPress(tag, local))
          .map((tag) => `${file}: ${buttonName(tag)}`)
          .filter((key) => !UNPRESSED.some((list) => list.has(key)))
      })
    expect(unpressed).toEqual([])
  })
})
