import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  REPLACE_CUES,
  REPLACE_PLAYLISTS,
  REPLACE_SECONDS,
  type ReplaceFrame,
  replaceFrame,
} from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'

// The replace flow drawn as the app draws it: the track list, the editor with its
// Apple Music pill, the split convert button and its stages, the converted footer and
// the Activity panel. The other scenes sketch the app; this one copies it, because a
// visitor who downloads Surco should find the same button saying the same thing.
// rekordbox sits beside it as a plain panel of its own data, not a copy of its UI.

const EASE = 'cubic-bezier(0.19, 1, 0.22, 1)'

const ROWS: { title: string; artist: string; duration: string; cover: string }[] = [
  {
    title: 'Bizarre Love Triangle',
    artist: '2 Rhythm, Marian Dacal',
    duration: '5:17',
    cover:
      'linear-gradient(135deg, var(--color-fg) 0 45%, var(--color-red) 45% 55%, var(--color-fg) 55%)',
  },
  {
    title: 'Possession (Dececio Remix)',
    artist: 'Transfer',
    duration: '7:12',
    cover:
      'radial-gradient(circle, var(--color-bg2) 0 12%, var(--color-amber) 12% 30%, var(--color-surface2) 31%)',
  },
  {
    title: 'Deep Love',
    artist: 'Baron Von Trax',
    duration: '6:21',
    cover: 'linear-gradient(160deg, var(--color-blue), var(--color-bg2))',
  },
  {
    title: 'Cuba Libre (Cuba Mix)',
    artist: 'Alegria',
    duration: '3:27',
    cover:
      'radial-gradient(circle, var(--color-fg) 0 20%, var(--color-muted) 21% 60%, var(--color-faint) 61%)',
  },
  {
    title: 'Bad Habit (Armin Van Buuren Remix)',
    artist: 'ATFC, OnePhatDeeva',
    duration: '9:16',
    cover: 'linear-gradient(135deg, var(--color-red), var(--color-bg2))',
  },
  {
    title: 'Not Tonight Pamela',
    artist: 'Boudi',
    duration: '6:44',
    cover: 'linear-gradient(135deg, var(--color-surface), var(--color-purple))',
  },
]
const PRIMARY = 1

function Glyph({ children, size = 15 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const RADIO = (
  <>
    <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
    <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
    <circle cx="12" cy="12" r="2" />
    <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
    <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
  </>
)
const SEARCH = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
)
const CHEVRON = <path d="m6 9 6 6 6-6" />

function Swap({
  on,
  from,
  to,
  className = '',
}: {
  on: boolean
  from: ReactNode
  to: ReactNode
  className?: string
}) {
  const leg = (shown: boolean, y: number): CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? 'none' : `translateY(${y}px)`,
    transition: `opacity 0.3s ease, transform 0.5s ${EASE}`,
  })
  return (
    <span className={`grid ${className}`}>
      <span className="col-start-1 row-start-1 truncate" style={leg(!on, -6)}>
        {from}
      </span>
      <span className="col-start-1 row-start-1 truncate" style={leg(on, 6)}>
        {to}
      </span>
    </span>
  )
}

function useCursor(
  frame: ReplaceFrame,
  win: RefObject<HTMLDivElement | null>,
  targets: Record<'button' | 'activity', RefObject<HTMLElement | null>>,
) {
  const [pos, setPos] = useState<[number, number]>([0, 0])
  useLayoutEffect(() => {
    const w = win.current
    if (!w || frame.cursor === 'hidden') return
    const box = w.getBoundingClientRect()
    if (frame.cursor === 'rest') {
      setPos([box.width * 0.7, box.height * 0.62])
      return
    }
    const el = targets[frame.cursor].current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos([r.left - box.left + r.width * 0.6, r.top - box.top + r.height * 0.55])
  }, [frame.cursor, win, targets])
  return pos
}

export default function ReplaceScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLDivElement>(null)
  const activityButton = useRef<HTMLSpanElement>(null)
  const [targets] = useState(() => ({ button, activity: activityButton }))
  const frame = replaceFrame(useSceneProgress(ref, REPLACE_SECONDS * 1000))
  const [cx, cy] = useCursor(frame, win, targets)

  const busy = frame.stage === 'converting' || frame.stage === 'appleMusic'
  const done = frame.stage === 'done'
  const stageLabel =
    frame.stage === 'appleMusic' ? t('home.replace.appleMusic') : t('home.replace.converting')

  return (
    <div
      ref={ref}
      className="mt-10 grid grid-cols-[minmax(0,1fr)] items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]"
    >
      <div
        ref={win}
        aria-hidden="true"
        className="inset-shadow-edge relative min-w-0 overflow-hidden rounded-xl border border-line bg-bg text-left shadow-2xl shadow-black/40"
      >
        <div className="flex h-11 items-center gap-1 border-b border-line bg-bg2 pr-2.5 pl-3.5">
          <span className="mr-auto flex gap-[7px]">
            <i className="block size-[11px] rounded-full bg-red" />
            <i className="block size-[11px] rounded-full bg-amber" />
            <i className="block size-[11px] rounded-full bg-green" />
          </span>
          <span className="grid size-[30px] place-items-center text-muted">
            <Glyph>{SEARCH}</Glyph>
          </span>
          <span
            ref={activityButton}
            className={`relative grid size-[30px] place-items-center rounded-lg transition-colors ${
              frame.activityOpen ? 'bg-[#292e42] text-fg' : 'text-muted'
            }`}
          >
            <Glyph>{RADIO}</Glyph>
            <i
              className="absolute top-1.5 right-1.5 block size-1.5 rounded-full bg-green transition-[opacity,transform] duration-300"
              style={{
                opacity: frame.activity === 'running' ? 1 : 0,
                transform: frame.activity === 'running' ? 'none' : 'scale(0.5)',
              }}
            />
          </span>
          <span className="mx-1.5 h-[18px] w-px bg-line" />
          <span className="flex h-[30px] items-center gap-1.5 rounded-lg bg-blue/15 px-2.5 text-[12.5px] font-medium text-blue">
            <Glyph size={14}>
              <path d="m16 3 4 4-4 4" />
              <path d="M20 7H4" />
              <path d="m8 21-4-4 4-4" />
              <path d="M4 17h16" />
            </Glyph>
            {t('home.replace.convertAll')}
          </span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] sm:h-[440px] sm:grid-cols-[minmax(0,15.5rem)_minmax(0,1fr)]">
          <div className="hidden overflow-hidden border-r border-line px-2 py-2.5 sm:block">
            <div className="mb-2.5 flex h-8 items-center gap-2 rounded-lg border border-line bg-bg2 px-2.5 text-[12.5px] text-faint">
              <Glyph size={13}>{SEARCH}</Glyph>
              {t('home.replace.search')}
            </div>
            {ROWS.map((row, i) => {
              const primary = i === PRIMARY
              const working = primary && busy
              return (
                <div
                  key={row.title}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${primary ? 'bg-blue/30' : ''}`}
                >
                  <span
                    className="relative size-8 flex-none outline outline-fg/10"
                    style={{
                      background: row.cover,
                      borderRadius: working ? '50%' : '6px',
                      transition: `border-radius 0.4s ${EASE}`,
                    }}
                  >
                    <i
                      className="absolute -inset-1 rounded-full transition-opacity duration-300"
                      style={{
                        opacity: working ? 1 : 0,
                        background: `conic-gradient(var(--color-fg) ${frame.progress}%, rgb(192 202 245 / 0.2) 0)`,
                        mask: 'radial-gradient(circle, transparent 18px, var(--color-bg) 18.5px)',
                        transition: `opacity 0.3s ease, background 0.9s ${EASE}`,
                      }}
                    />
                    <i
                      className="absolute -right-[3px] -bottom-[3px] grid size-[13px] place-items-center rounded-full bg-blue text-[8px] font-bold text-bg ring-2 ring-bg2"
                      style={{
                        opacity: primary && done ? 1 : 0,
                        transform: primary && done ? 'none' : 'scale(0.6)',
                        transition: `opacity 0.2s ease, transform 0.4s ${EASE}`,
                      }}
                    >
                      ✓
                    </i>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg">
                        {row.title}
                      </span>
                      <span className="w-[34px] text-right text-[11.5px] tabular-nums text-muted">
                        {row.duration}
                      </span>
                    </span>
                    <span className="mt-px flex items-center gap-1.5">
                      <Swap
                        on={working}
                        from={<span className="text-muted">{row.artist}</span>}
                        to={<span className="text-fg">{stageLabel}</span>}
                        className="min-w-0 flex-1 text-[11.5px]"
                      />
                      <span className="flex w-[46px] justify-end">
                        <span className="inline-flex h-4 items-center rounded bg-green/15 px-[5px] text-[10px] font-semibold text-green">
                          AIFF
                        </span>
                      </span>
                    </span>
                  </span>
                </div>
              )
            })}
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex-1 overflow-hidden px-6 pt-[18px] pb-5">
              <p className="flex items-center gap-2.5 text-xs text-muted">
                {t('home.replace.file')}
                <span className="h-px flex-1 bg-line" />
              </p>
              <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-fg">
                <Glyph size={13}>{CHEVRON}</Glyph>
                {t('home.replace.metadata')}
                <span className="ml-1 inline-flex items-center gap-1.5 text-xs font-medium text-[#a9b1d6]">
                  <span className="text-green">
                    <Glyph size={13}>
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </Glyph>
                  </span>
                  Apple Music <span>· MP3 320</span>
                </span>
              </p>
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-[18px] sm:grid-cols-[112px_minmax(0,1fr)]">
                <span
                  className="hidden size-28 rounded-lg sm:block"
                  style={{
                    background:
                      'radial-gradient(circle, var(--color-bg2) 0 7%, var(--color-amber) 7% 26%, var(--color-surface2) 27%)',
                  }}
                />
                <div>
                  {[
                    [t('home.replace.fieldTitle'), 'Possession (Dececio Remix)'],
                    [t('home.replace.fieldArtist'), 'Transfer'],
                    [t('home.replace.fieldAlbum'), 'Possession'],
                    [t('home.replace.fieldLabel'), 'Toolroom'],
                  ].map(([label, value]) => (
                    <div key={label} className="mb-3.5">
                      <p className="mb-1.5 text-[12.5px] text-muted">{label}</p>
                      <p className="flex h-[34px] items-center truncate rounded-[7px] border border-[#737aa2]/45 bg-bg2 px-[11px] text-[13.5px] text-fg">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative h-[66px] border-t border-line bg-bg2">
              <div
                className="absolute inset-0 flex items-center px-[22px]"
                style={{
                  opacity: done ? 0 : 1,
                  transform: done ? 'translateY(8px)' : 'none',
                  transition: `opacity 0.3s ease, transform 0.45s ${EASE}`,
                }}
              >
                <div
                  ref={button}
                  className={`relative grid h-10 flex-1 place-items-center overflow-hidden rounded-l-lg text-sm font-medium transition-[background-color,transform] duration-150 ${
                    busy ? 'bg-blue/40 text-fg' : 'bg-blue text-bg'
                  }`}
                  style={{ transform: frame.pressed ? 'scale(0.985)' : 'none' }}
                >
                  <span
                    className="absolute inset-y-0 left-0 overflow-hidden bg-blue"
                    style={{
                      width: `${busy ? frame.progress : 0}%`,
                      transition: `width 0.9s ${EASE}`,
                    }}
                  >
                    {busy && (
                      <span
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-fg/30 to-transparent"
                        style={{ animation: 'sheen 1.3s linear infinite' }}
                      />
                    )}
                  </span>
                  <Swap
                    on={busy}
                    from={t('home.replace.button')}
                    to={stageLabel}
                    className="relative text-center"
                  />
                </div>
                <div
                  className={`grid h-10 w-10 place-items-center rounded-r-lg border-l border-fg/20 transition-colors ${
                    busy ? 'bg-blue/40 text-fg' : 'bg-blue text-bg'
                  }`}
                >
                  <Glyph size={12}>{CHEVRON}</Glyph>
                </div>
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
                    <Glyph size={10}>{CHEVRON}</Glyph>
                  </span>
                </span>
              </div>
            </div>
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
            <Glyph size={14}>{RADIO}</Glyph>
            {t('home.replace.activity')}
          </p>
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-fg">
            <span className="relative size-3.5">
              <span
                className="absolute inset-0 text-muted transition-opacity"
                style={{
                  opacity: frame.activity === 'done' ? 0 : 1,
                  animation: frame.activity === 'running' ? 'spin 0.8s linear infinite' : undefined,
                }}
              >
                <Glyph size={14}>
                  <path d="M21 12a9 9 0 1 1-6.2-8.6" />
                </Glyph>
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

        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="pointer-events-none absolute top-0 left-0 z-20 size-[18px] drop-shadow"
          style={{
            opacity: frame.cursor === 'hidden' ? 0 : 1,
            transform: `translate(${cx}px, ${cy}px)`,
            transition: 'transform 0.8s cubic-bezier(0.645, 0.045, 0.355, 1), opacity 0.3s ease',
          }}
        >
          <path
            d="M4 2l16 10-7 1.5L9.5 21z"
            fill="var(--color-fg)"
            stroke="var(--color-bg2)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>

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
          <p className="truncate text-[13px] text-fg">Possession (Dececio Remix)</p>
          <p className="mt-0.5 text-[11.5px] text-muted">Transfer · 124.00 · 8A</p>
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
