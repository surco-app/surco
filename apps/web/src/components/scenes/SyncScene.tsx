import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CRATE } from '../../lib/crate'
import {
  SYNC_ACT1,
  SYNC_LIBRARIES,
  SYNC_SECONDS,
  SYNC_START,
  type SyncValues,
  syncFrame,
} from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import {
  AppField,
  AppWindow,
  ConvertButton,
  Cover,
  EASE,
  EditorFooter,
  Glyph,
  Swap,
  ToolbarButton,
} from './AppChrome'

// One edit in Surco, on a track opened from a program's tab, reaching every library once
// Update is pressed. The libraries are plain panels of their own data, not copies of their UI.

const TRACK = CRATE.milk

export default function SyncScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const frame = syncFrame(useSceneProgress(ref, SYNC_SECONDS * 1000))
  const fromRekordbox = frame.origin === 'rekordbox'

  return (
    <div
      ref={ref}
      className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]"
    >
      <AppWindow
        action={
          <ToolbarButton>
            <Swap
              on={fromRekordbox}
              from={t('home.sync.tabAppleMusic')}
              to={t('home.sync.tabRekordbox')}
            />
          </ToolbarButton>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden px-6 pt-[18px] pb-2">
            <div className="flex items-center gap-3.5">
              <span className="size-14 flex-none overflow-hidden rounded-lg">
                <Cover src={TRACK.cover} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">{frame.fields.title}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">{TRACK.artist}</p>
              </div>
            </div>
            <div className="mt-5">
              <AppField label={t('home.sync.fieldTitle')} flash={frame.typing === 'title'}>
                {frame.fields.title}
              </AppField>
              <AppField label={t('home.sync.fieldGenre')} flash={frame.typing === 'genre'}>
                {frame.fields.genre}
              </AppField>
              <AppField label={t('home.sync.fieldFile')} flash={frame.typing === 'file'}>
                <span className="truncate font-mono text-[12px]">{frame.fields.file}</span>
              </AppField>
            </div>
          </div>
          <EditorFooter>
            <span
              className="mr-4 hidden text-xs font-medium whitespace-nowrap text-green transition-opacity duration-300 sm:inline"
              style={{ opacity: frame.saved ? 1 : 0 }}
            >
              ✓ {t('home.sync.saved')}
            </span>
            <ConvertButton pressed={frame.pressed} label={t('home.sync.button')} />
          </EditorFooter>
        </div>
      </AppWindow>

      <ul data-ui aria-hidden="true" className="grid content-start gap-2.5">
        {SYNC_LIBRARIES.map((name, i) => {
          const row = frame.libraries[i]
          const origin = (i === 0 && !fromRekordbox) || (i === 1 && fromRekordbox)
          const done = i < frame.updated
          const before = fromRekordbox ? SYNC_ACT1 : SYNC_START
          const tone = (key: keyof SyncValues, rest: string) =>
            `${done && row[key] !== before[key] ? 'text-blue' : rest} transition-colors duration-500`
          return (
            <li
              key={name}
              className={`min-w-0 overflow-hidden rounded-xl border bg-scrim text-left transition-[border-color] duration-500 ${
                origin ? 'border-blue/55' : 'border-line'
              }`}
            >
              <p className="flex h-[30px] items-center gap-2 border-b border-line bg-bg2 px-3 text-[11px] tracking-[0.06em] text-muted uppercase">
                {name}
                <span
                  className="tracking-normal text-blue normal-case transition-opacity duration-300"
                  style={{ opacity: origin ? 1 : 0 }}
                >
                  {t('home.sync.origin')}
                </span>
                <span
                  className="ml-auto text-green"
                  style={{
                    opacity: done ? 1 : 0,
                    transform: done ? 'none' : 'scale(0.6)',
                    transition: `opacity 0.2s ease, transform 0.35s ${EASE}`,
                  }}
                >
                  <Glyph size={13}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="m8 12 3 3 5-6" />
                  </Glyph>
                </span>
              </p>
              <div className="grid gap-0.5 px-3 py-2.5">
                <p className={`truncate text-[12.5px] ${tone('title', 'text-fg')}`}>{row.title}</p>
                <p className="truncate text-[11.5px] text-muted">
                  {TRACK.artist} · <span className={tone('genre', 'text-muted')}>{row.genre}</span>
                </p>
                <p className={`truncate font-mono text-[10.5px] ${tone('file', 'text-subtle')}`}>
                  {row.file}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
