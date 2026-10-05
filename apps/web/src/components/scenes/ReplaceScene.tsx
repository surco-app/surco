import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CRATE } from '../../lib/crate'
import { REPLACE_CUES, REPLACE_PLAYLISTS, REPLACE_SECONDS, replaceFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import {
  AppField,
  AppRow,
  AppWindow,
  ConvertButton,
  Cover,
  EASE,
  EditorFooter,
  Glyph,
  ICONS,
  SceneCursor,
  SearchBox,
  Spinner,
  Swap,
  ToolbarButton,
} from './AppChrome'

// The replace flow drawn as the app draws it: the track list, the editor with its
// Apple Music pill, the split convert button and its stages, the converted footer and
// the Activity panel. rekordbox sits beside it as a plain panel of its own data, not
// a copy of its UI.

const ROWS = [CRATE.sash, CRATE.transfer, CRATE.ivd, CRATE.karen, CRATE.lasgo, CRATE.tukan]
const PRIMARY = 1
const TRACK = CRATE.transfer
const REST = [0.7, 0.62] as const

export default function ReplaceScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLDivElement>(null)
  const activityButton = useRef<HTMLSpanElement>(null)
  const frame = replaceFrame(useSceneProgress(ref, REPLACE_SECONDS * 1000))
  const [targets] = useState(() => ({ button, activity: activityButton, rest: REST }))

  const busy = frame.stage === 'converting' || frame.stage === 'appleMusic'
  const done = frame.stage === 'done'
  const stageLabel =
    frame.stage === 'appleMusic' ? t('home.replace.appleMusic') : t('home.replace.converting')

  return (
    <div
      ref={ref}
      className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]"
    >
      <AppWindow
        windowRef={win}
        activity={{
          ref: activityButton,
          open: frame.activityOpen,
          running: frame.activity === 'running',
        }}
        action={
          <ToolbarButton>
            <Glyph size={14}>{ICONS.convert}</Glyph>
            {t('home.replace.convertAll')}
          </ToolbarButton>
        }
      >
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)] sm:min-h-[440px] sm:grid-cols-[minmax(0,15.5rem)_minmax(0,1fr)]">
          <div className="hidden overflow-hidden border-r border-line px-2 py-2.5 sm:block">
            <div className="mb-2.5">
              <SearchBox>{t('home.replace.search')}</SearchBox>
            </div>
            {ROWS.map((row, i) => {
              const primary = i === PRIMARY
              return (
                <AppRow
                  key={row.title}
                  title={row.title}
                  artist={row.artist}
                  duration={row.duration}
                  format="AIFF"
                  cover={row.cover}
                  selected={primary ? 'primary' : undefined}
                  stage={primary && busy ? stageLabel : null}
                  ring={primary && busy ? frame.progress : null}
                  done={primary && done}
                />
              )
            })}
          </div>

          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden px-6 pt-[18px] pb-5">
              <p className="flex items-center gap-2.5 text-xs text-muted">
                {t('home.replace.file')}
                <span className="h-px flex-1 bg-line" />
              </p>
              <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-fg">
                <Glyph size={13}>{ICONS.chevron}</Glyph>
                {t('home.replace.metadata')}
                <span className="ml-1 inline-flex items-center gap-1.5 text-xs font-medium text-[#a9b1d6]">
                  <span className="text-green">
                    <Glyph size={13}>{ICONS.note}</Glyph>
                  </span>
                  Apple Music <span>· MP3 320</span>
                </span>
              </p>
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-[18px] sm:grid-cols-[112px_minmax(0,1fr)]">
                <span className="hidden size-28 overflow-hidden rounded-lg sm:block">
                  <Cover src={TRACK.cover} />
                </span>
                <div>
                  <AppField label={t('home.replace.fieldTitle')}>{TRACK.title}</AppField>
                  <AppField label={t('home.replace.fieldArtist')}>{TRACK.artist}</AppField>
                  <AppField label={t('home.replace.fieldAlbum')}>{TRACK.album}</AppField>
                  <AppField label={t('home.replace.fieldYear')} short>
                    {TRACK.year}
                  </AppField>
                </div>
              </div>
            </div>

            <EditorFooter>
              <div
                className="absolute inset-0 flex items-center px-[22px]"
                style={{
                  opacity: done ? 0 : 1,
                  transform: done ? 'translateY(8px)' : 'none',
                  transition: `opacity 0.3s ease, transform 0.45s ${EASE}`,
                }}
              >
                <ConvertButton
                  buttonRef={button}
                  pressed={frame.pressed}
                  progress={busy ? frame.progress : null}
                  label={
                    <Swap
                      on={busy}
                      from={t('home.replace.button')}
                      to={stageLabel}
                      className="text-center"
                    />
                  }
                />
              </div>

              <div
                className="absolute inset-0 flex items-center gap-1.5 px-[22px]"
                style={{
                  opacity: done ? 1 : 0,
                  transform: done ? 'none' : 'translateY(-8px)',
                  transition: `opacity 0.3s ease, transform 0.45s ${EASE}`,
                }}
              >
                <span className="mr-1.5 inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-green">
                  {t('home.replace.added')}
                  <Glyph size={12}>
                    <path d="M7 17 17 7M8 7h9v9" />
                  </Glyph>
                </span>
                <span className="grid size-8 place-items-center text-muted">
                  <Glyph>
                    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                  </Glyph>
                </span>
                <span className="mx-1 h-4 w-px bg-line" />
                <span className="grid size-8 place-items-center text-muted">
                  <Glyph>
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="2" />
                  </Glyph>
                </span>
                <span className="ml-auto flex h-8 rounded-lg border border-line bg-[#292e42] text-muted">
                  <span className="grid w-8 place-items-center">
                    <Glyph size={14}>
                      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                      <path d="M21 3v5h-5" />
                    </Glyph>
                  </span>
                  <span className="grid w-[22px] place-items-center border-l border-line">
                    <Glyph size={10}>{ICONS.chevron}</Glyph>
                  </span>
                </span>
              </div>
            </EditorFooter>
          </div>
        </div>

        <div
          className="absolute top-[50px] right-2.5 z-10 w-[min(330px,calc(100%-20px))] origin-top-right rounded-xl border border-line bg-bg shadow-2xl shadow-black/60"
          style={{
            opacity: frame.activityOpen ? 1 : 0,
            transform: frame.activityOpen ? 'none' : 'scale(0.96) translateY(-4px)',
            transition: `opacity 0.2s ease, transform 0.35s ${EASE}`,
          }}
        >
          <p className="flex items-center gap-2 border-b border-line px-3 py-2.5 text-[12.5px] font-semibold text-fg">
            <Glyph size={14}>{ICONS.radio}</Glyph>
            {t('home.replace.activity')}
          </p>
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-fg">
            <span className="relative size-3.5">
              <span
                className="absolute inset-0 text-muted transition-opacity"
                style={{ opacity: frame.activity === 'done' ? 0 : 1 }}
              >
                {frame.activity === 'running' ? (
                  <Spinner size={14} />
                ) : (
                  <Glyph size={14}>{ICONS.spin}</Glyph>
                )}
              </span>
              <span
                className="absolute inset-0 text-green"
                style={{
                  opacity: frame.activity === 'done' ? 1 : 0,
                  transform: frame.activity === 'done' ? 'none' : 'scale(0.6)',
                  transition: `opacity 0.2s ease, transform 0.35s ${EASE}`,
                }}
              >
                <Glyph size={14}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="m8 12 3 3 5-6" />
                </Glyph>
              </span>
            </span>
            {t('home.replace.activityRow')}
          </p>
          <p
            className="ml-[34px] overflow-hidden font-mono text-[10.5px] text-[#a9b1d6]"
            style={{
              height: frame.activity === 'done' ? 26 : 0,
              opacity: frame.activity === 'done' ? 1 : 0,
              transition: `height 0.35s ${EASE}, opacity 0.3s ease`,
            }}
          >
            {t('home.replace.activityDetail')}
          </p>
        </div>

        <SceneCursor
          container={win}
          target={frame.cursor === 'hidden' ? null : targets[frame.cursor]}
        />
      </AppWindow>

      <div
        className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-scrim text-left shadow-2xl shadow-black/40 transition-[border-color] duration-500 ${
          frame.repointed && !frame.saved ? 'border-blue/55' : 'border-line'
        }`}
      >
        <p className="flex h-[34px] items-center border-b border-line bg-bg2 px-3 text-[11px] tracking-[0.06em] text-muted uppercase">
          rekordbox
          <span className="ml-auto tracking-normal text-faint normal-case">
            {t('home.replace.collection')}
          </span>
        </p>
        <div className="flex flex-1 flex-col p-3.5">
          <p className="truncate text-[13px] text-fg">{TRACK.title}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">{TRACK.artist}</p>
          <p className="mt-3.5 text-[10px] tracking-[0.06em] text-faint uppercase">
            {t('home.replace.location')}
          </p>
          <Swap
            on={frame.repointed}
            from={<span className="text-muted">…/02 Possession (Dececio Remix).mp3</span>}
            to={<span className="text-blue">…/Transfer - Possession (Dececio Remix).aiff</span>}
            className="mt-1 font-mono text-[10.5px]"
          />
          <p className="mt-3.5 text-[10px] tracking-[0.06em] text-faint uppercase">
            {t('home.replace.inPlaylists')}
          </p>
          <ul className="mt-1.5 mb-3.5 grid gap-px">
            {REPLACE_PLAYLISTS.map((name, i) => {
              const ok = i < frame.playlistsConfirmed
              return (
                <li
                  key={name}
                  className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors duration-300 ${
                    ok ? 'bg-green/[0.07] text-fg' : 'text-[#a9b1d6]'
                  }`}
                >
                  <span className="text-faint">
                    <Glyph size={12}>
                      <path d="M3 6h13M3 12h13M3 18h9" />
                      <path d="M19 15v6M16 18h6" />
                    </Glyph>
                  </span>
                  {name}
                  <span
                    className="ml-auto text-[11px] text-green"
                    style={{
                      opacity: ok ? 1 : 0,
                      transform: ok ? 'none' : 'translateX(-4px)',
                      transition: `opacity 0.25s ease, transform 0.35s ${EASE}`,
                    }}
                  >
                    ✓
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="mt-auto grid grid-cols-2 gap-2.5 border-t border-line pt-3">
            {[
              [
                t('home.replace.playlistsLabel'),
                REPLACE_PLAYLISTS.length,
                t('home.replace.intact'),
              ],
              [t('home.replace.cuesLabel'), REPLACE_CUES, t('home.replace.inPlace')],
            ].map(([label, value, note]) => (
              <div key={label}>
                <p className="text-[10px] tracking-[0.06em] text-faint uppercase">{label}</p>
                <p className="mt-0.5 font-mono text-[17px] tabular-nums text-fg">{value}</p>
                <p
                  className="font-mono text-[10px] text-green transition-opacity duration-500"
                  style={{ opacity: frame.stats ? 1 : 0 }}
                >
                  {note}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="flex flex-wrap items-baseline justify-center gap-3.5 text-[15px] text-muted lg:col-span-2">
        <span className="relative text-faint">
          {t('home.replace.before')}
          <span
            className="absolute -inset-x-0.5 top-[55%] h-[1.5px] origin-left bg-red"
            style={{
              transform: frame.saved ? 'scaleX(1)' : 'scaleX(0)',
              transition: `transform 0.6s ${EASE}`,
            }}
          />
        </span>
        <span
          className="font-semibold text-fg"
          style={{
            opacity: frame.saved ? 1 : 0,
            transform: frame.saved ? 'none' : 'translateY(6px)',
            transition: `opacity 0.4s ease 0.25s, transform 0.6s ${EASE} 0.25s`,
          }}
        >
          {t('home.replace.after')}
        </span>
      </p>
    </div>
  )
}
