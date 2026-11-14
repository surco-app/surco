import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CRATE } from '../../lib/crate'
import { MATCHING_CHAINS, MATCHING_SECONDS, matchingFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { AppWindow, Cover, EASE, Glyph, ToolbarButton } from './AppChrome'

const RINGS = (
  <>
    <circle cx="8.5" cy="12" r="5.5" />
    <circle cx="15.5" cy="12" r="5.5" />
  </>
)

const CHAINS = MATCHING_CHAINS.map((chain) => chain.map((key) => CRATE[key]))
const ORDER = CHAINS.flat()
const STARTS = CHAINS.map((_, c) => CHAINS.slice(0, c).flat().length)

export default function MatchingScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const frame = matchingFrame(useSceneProgress(ref, MATCHING_SECONDS * 1000))

  return (
    <div
      ref={ref}
      className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]"
    >
      <AppWindow
        action={
          <span
            className="inline-flex transition-transform duration-150"
            style={{ transform: frame.pressed ? 'scale(0.95)' : 'none' }}
          >
            <ToolbarButton>{t('home.matching.button')}</ToolbarButton>
          </span>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-4 pb-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span className="text-blue">
              <Glyph size={15}>{RINGS}</Glyph>
            </span>
            Matching
          </p>
          {CHAINS.map((chain, c) => (
            <div key={chain[0].title} className="rounded-xl border border-line p-1">
              {chain.map((track, i) => {
                const visible = STARTS[c] + i < frame.shown
                return (
                  <div
                    key={track.title}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
                    style={{
                      opacity: visible ? 1 : 0,
                      transform: visible ? 'none' : 'translateY(6px)',
                      transition: `opacity 0.3s ease, transform 0.5s ${EASE}`,
                    }}
                  >
                    <span className="size-9 flex-none overflow-hidden rounded-md">
                      <Cover src={track.cover} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-fg">{track.title}</span>
                      <span className="block truncate text-[11.5px] text-muted">
                        {track.artist}
                      </span>
                    </span>
                    <span className="text-[11.5px] text-muted tabular-nums">{track.duration}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </AppWindow>

      <div
        data-ui
        aria-hidden="true"
        className="min-w-0 self-start overflow-hidden rounded-xl border border-line bg-scrim text-left"
      >
        <p className="flex h-[30px] items-center gap-2 border-b border-line bg-bg2 px-3 text-[11px] tracking-[0.06em] text-muted uppercase">
          rekordbox
          <span className="tracking-normal text-blue normal-case">
            {t('home.matching.playlist')}
          </span>
        </p>
        <ul className="grid gap-0.5 px-3 py-2.5">
          {ORDER.map((track, i) => {
            const added = i < frame.added
            return (
              <li
                key={track.title}
                className="flex min-w-0 items-center gap-2 py-0.5"
                style={{
                  opacity: added ? 1 : 0,
                  transform: added ? 'none' : 'translateX(-6px)',
                  transition: `opacity 0.25s ease, transform 0.45s ${EASE}`,
                }}
              >
                <span className="text-green">
                  <Glyph size={12}>
                    <path d="m5 12 4.5 4.5L19 7" />
                  </Glyph>
                </span>
                <span className="min-w-0 truncate text-[12.5px] text-fg">{track.title}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
