import { type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { REVIEW_SECONDS, reviewFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { AppWindow, EASE, Glyph, ICONS, SceneCursor, Spinner, Swap } from './AppChrome'

type Kind = 'case' | 'invisible' | 'punctuation' | 'typo' | 'duplicate'

const GROUPS: { name: string; kind: Kind; meta: 'tracks' | 'batch' | 'both' | 'copies' }[] = [
  { name: 'DJ Lara', kind: 'case', meta: 'tracks' },
  { name: 'Aarón Alfonso', kind: 'invisible', meta: 'batch' },
  { name: "Head Horny's", kind: 'punctuation', meta: 'batch' },
  { name: 'Rahcel Auburn', kind: 'typo', meta: 'both' },
  { name: 'DJ Ter · This Rap', kind: 'duplicate', meta: 'copies' },
  { name: 'Greenfield · Violet Club Sandwich', kind: 'duplicate', meta: 'copies' },
]
const TYPO_ROW = 3
const MOBILE_ROWS = 4

const TRACKS = ["Bass Keeps Pumpin' (Mr Bishi Remix)", "Bass Keeps Pumpin' (Knuckleheadz Mix)"]

const COPIES_GLYPH = (
  <>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M4 16V5a1 1 0 0 1 1-1h11" />
  </>
)

function Spelled({ middle, tone }: { middle: string; tone: string }) {
  return (
    <>
      Ra<span className={tone}>{middle}</span>el Auburn
    </>
  )
}

function Chip({ children, tone = 'text-muted' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`mr-1 rounded-full bg-surface px-1.5 py-px text-[10.5px] ${tone}`}>
      {children}
    </span>
  )
}

const shown = (on: boolean, y = 6) => ({
  opacity: on ? 1 : 0,
  transform: on ? 'none' : `translateY(${y}px)`,
  transition: `opacity 0.3s ease, transform 0.5s ${EASE}`,
})

export default function ReviewScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const option = useRef<HTMLDivElement>(null)
  const apply = useRef<HTMLSpanElement>(null)
  const frame = reviewFrame(useSceneProgress(ref, REVIEW_SECONDS * 1000))
  const [targets] = useState(() => ({ group, option, apply }))
  const staged = frame.applyCount > 2

  const meta = (m: (typeof GROUPS)[number]['meta']) =>
    m === 'tracks'
      ? `${t('home.review.artist')} · ${t('home.review.tracks', { count: 12 })}`
      : m === 'batch'
        ? `${t('home.review.artist')} · ${t('home.review.inBatch')}`
        : m === 'both'
          ? t('home.review.bothArtists')
          : t('home.review.copies', { count: 2 })

  return (
    <div ref={ref}>
      <AppWindow
        windowRef={win}
        action={
          <span
            ref={apply}
            className={`flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold whitespace-nowrap transition-[background-color,color,transform] duration-200 ${
              frame.applied ? 'bg-[#292e42] text-muted' : 'bg-blue text-bg'
            }`}
            style={{ transform: frame.pressed ? 'scale(0.96)' : 'none' }}
          >
            {frame.applying && <Spinner size={12} />}
            <Swap
              on={staged}
              from={t('home.review.applyCount', { count: 2 })}
              to={t('home.review.applyCount', { count: frame.applyCount })}
            />
          </span>
        }
      >
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)] sm:min-h-[430px] sm:grid-cols-[minmax(0,16.5rem)_minmax(0,1fr)]">
          <div className="border-b border-line px-2 py-2.5 sm:border-r sm:border-b-0">
            <p className="flex items-center gap-1.5 px-2 pt-1 pb-2.5 text-xs text-muted">
              <Glyph size={13}>
                <path d="M4 6h16M7 12h10M10 18h4" />
              </Glyph>
              {t('home.review.all')} <span className="text-faint">58</span>
              <Glyph size={11}>{ICONS.chevron}</Glyph>
            </p>
            {GROUPS.map((g, i) => {
              const typo = i === TYPO_ROW
              const selected = typo && frame.selected
              const inBatch = g.meta === 'batch' || (typo && staged)
              return (
                <div
                  key={g.name}
                  ref={typo ? group : undefined}
                  className={`items-center gap-2.5 rounded-lg px-2 py-2 transition-colors duration-300 ${
                    i < MOBILE_ROWS ? 'flex' : 'hidden sm:flex'
                  } ${selected ? 'bg-blue/30' : ''}`}
                  style={shown(i < frame.rows)}
                >
                  <span className="relative grid size-7 flex-none place-items-center rounded-md bg-[#292e42] text-faint">
                    <Glyph size={13}>{g.kind === 'duplicate' ? COPIES_GLYPH : ICONS.note}</Glyph>
                    <i
                      className="absolute -right-0.5 -bottom-0.5 block size-[9px] rounded-full border-2 border-amber bg-bg"
                      style={{
                        opacity: inBatch ? 1 : 0,
                        transform: inBatch ? 'none' : 'scale(0.4)',
                        transition: `opacity 0.2s ease, transform 0.4s ${EASE}`,
                      }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    {typo ? (
                      <Swap
                        on={frame.picked}
                        from="Rahcel Auburn"
                        to="Rachel Auburn"
                        className="text-[13px] font-medium text-fg"
                      />
                    ) : (
                      <span className="block truncate text-[13px] font-medium text-fg">
                        {g.name}
                      </span>
                    )}
                    <span className="block truncate text-[11.5px] text-muted">{meta(g.meta)}</span>
                  </span>
                  <span
                    className={`rounded px-[5px] py-px text-[10px] font-semibold whitespace-nowrap ${
                      typo ? 'bg-amber/20 text-amber' : 'bg-green/15 text-green'
                    }`}
                  >
                    {t(`home.review.badge.${g.kind}`)}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="min-w-0 bg-surface2 px-5 pt-5 pb-5 sm:px-6">
            <div style={shown(frame.selected, 8)}>
              <p className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                <Swap on={frame.picked} from="Rahcel Auburn" to="Rachel Auburn" />
              </p>
              <p className="mt-0.5 text-xs text-faint">
                {t('home.review.bothArtists')} · {t('home.review.typo')}
              </p>
              <Swap
                on={frame.picked}
                from={<span className="text-amber">{t('home.review.tie')}</span>}
                to={<span className="text-faint">{t('home.review.options')}</span>}
                className="mt-4 mb-1.5 text-xs"
              />
              {[
                { name: 'Rachel Auburn', keep: true },
                { name: 'Rahcel Auburn', keep: false },
              ].map(({ name, keep }) => {
                const on = keep && frame.picked
                return (
                  <div
                    key={name}
                    ref={keep ? option : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg transition-colors duration-300 ${
                      on ? 'bg-blue/30' : ''
                    }`}
                  >
                    <span
                      className={`grid size-3 flex-none place-items-center rounded-full border-2 transition-colors duration-200 ${
                        on ? 'border-blue' : 'border-faint'
                      }`}
                    >
                      <i
                        className="block size-1 rounded-full bg-blue transition-transform duration-200"
                        style={{ transform: on ? 'none' : 'scale(0)' }}
                      />
                    </span>
                    {name}
                    {keep && (
                      <span
                        className="text-[11px] font-semibold text-blue"
                        style={{
                          opacity: on ? 1 : 0,
                          transform: on ? 'none' : 'translateX(-4px)',
                          transition: `opacity 0.25s ease, transform 0.35s ${EASE}`,
                        }}
                      >
                        {t('home.review.keeps')}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-faint">
                      {t('home.review.tracks', { count: 2 })}
                    </span>
                  </div>
                )
              })}

              <table className="mt-4 w-full table-fixed border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-faint">
                    <th className="hidden py-1.5 pr-2.5 font-normal sm:table-cell">
                      {t('home.review.fieldTitle')}
                    </th>
                    <th className="py-1.5 pr-2.5 font-normal sm:w-[22%]">{t('home.review.now')}</th>
                    <th className="py-1.5 pr-2.5 font-normal sm:w-[22%]">
                      {t('home.review.after')}
                    </th>
                    <th className="hidden w-[11.5rem] py-1.5 font-normal lg:table-cell">
                      {t('home.review.where')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TRACKS.map((title, i) => (
                    <tr key={title} className="border-b border-line">
                      <td className="hidden truncate py-2 pr-2.5 text-fg sm:table-cell">{title}</td>
                      <td className="truncate py-2 pr-2.5 text-muted">
                        <Spelled middle="hc" tone="text-amber" />
                      </td>
                      <td className="py-2 pr-2.5">
                        <Swap
                          on={i < frame.resolved}
                          from={
                            <span className="text-faint">
                              <Spelled middle="hc" tone="" />
                            </span>
                          }
                          to={
                            <span className="text-fg">
                              <Spelled middle="ch" tone="text-green" />
                            </span>
                          }
                        />
                      </td>
                      <td className="hidden py-2 whitespace-nowrap lg:table-cell">
                        <Chip>{t('home.review.music')}</Chip>
                        <Chip>{t('home.review.file')}</Chip>
                        <Chip tone="text-cyan">rekordbox</Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p
                className="mt-4 flex items-center gap-2 text-xs text-muted"
                style={shown(frame.applied)}
              >
                <b className="text-green">✓</b>
                {t('home.review.done')}
              </p>
            </div>
          </div>
        </div>

        <SceneCursor
          container={win}
          target={frame.cursor === 'hidden' ? null : targets[frame.cursor]}
        />
      </AppWindow>
    </div>
  )
}
