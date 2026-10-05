import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DROP_TRACKS, dropFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import {
  AppField,
  AppRow,
  AppWindow,
  ConvertButton,
  Cover,
  EditorFooter,
  Glyph,
  ICONS,
  SearchBox,
  SectionTitle,
  ToolbarButton,
} from './AppChrome'

const PILE = ['MP3', 'WAV', 'FLAC']

// The app's empty window, a pile of files dragged onto it, and the import the app
// runs: every row listed at once and read in turn while the toolbar counts.
export default function DropScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  const frame = dropFrame(useSceneProgress(ref, 7000))
  const dropped = frame.rows.length > 0
  const first = frame.rows[0]
  const firstRead = first?.state === 'done'

  return (
    <div ref={ref}>
      <AppWindow
        status={
          frame.stage === 'reading' && (
            <span className="mr-1 flex h-[30px] items-center gap-1.5 px-2 text-[12.5px] whitespace-nowrap text-blue tabular-nums">
              <Glyph size={14}>{ICONS.file}</Glyph>
              {t('home.drop.reading', { read: frame.read, total: frame.total })}
            </span>
          )
        }
        action={
          <ToolbarButton quiet={frame.stage !== 'done'}>
            <Glyph size={14}>{ICONS.convert}</Glyph>
            {frame.stage === 'done'
              ? t('home.app.convertCount', { count: frame.total })
              : t('home.app.convert')}
          </ToolbarButton>
        }
      >
        <div className="relative grid h-[400px] grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,14.5rem)_minmax(0,1fr)]">
          <div className="hidden overflow-hidden border-r border-line px-2 py-2.5 sm:block">
            <div className="mb-2.5">
              <SearchBox>{t('home.app.search')}</SearchBox>
            </div>
            {frame.rows.map((row, i) => (
              <AppRow
                key={row.title}
                title={row.title}
                artist={row.artist}
                duration={row.duration}
                format={row.format}
                tone="plain"
                cover={row.cover}
                loading={row.state === 'loading'}
                selected={i === 0 ? 'primary' : undefined}
              />
            ))}
          </div>

          <div className="flex min-w-0 flex-col" style={{ opacity: dropped ? 1 : 0 }}>
            <div className="flex-1 overflow-hidden px-6 pt-[18px]">
              <p className="flex items-center gap-2.5 text-xs text-muted">
                {t('home.app.file')}
                <span className="h-px flex-1 bg-line" />
              </p>
              <div className="mt-4">
                <SectionTitle
                  aside={
                    <>
                      <Glyph size={13}>{ICONS.note}</Glyph>
                      {t('home.app.notInLibrary')}
                    </>
                  }
                >
                  {t('home.app.metadata')}
                </SectionTitle>
              </div>
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-[18px] sm:grid-cols-[96px_minmax(0,1fr)]">
                <span className="hidden size-24 overflow-hidden rounded-lg bg-[#292e42] sm:block">
                  {firstRead ? (
                    <Cover src={first.cover} />
                  ) : (
                    <span className="grid size-full place-items-center text-faint">
                      <Glyph size={22}>{ICONS.image}</Glyph>
                    </span>
                  )}
                </span>
                <div>
                  <AppField label={t('home.app.fieldTitle')}>{first?.title}</AppField>
                  <AppField label={t('home.app.fieldArtist')}>{firstRead && first.artist}</AppField>
                  <AppField label={t('home.app.fieldAlbum')}>
                    {firstRead && DROP_TRACKS[0].album}
                  </AppField>
                </div>
              </div>
            </div>
            <EditorFooter>
              <ConvertButton
                off={!firstRead}
                label={
                  firstRead ? (
                    t('home.app.convertTo')
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <i className="block size-1.5 rounded-full bg-amber" />
                      {t('home.app.missingArtist')}
                    </span>
                  )
                }
              />
            </EditorFooter>
          </div>

          <div
            className="absolute inset-0 grid place-items-center bg-bg px-6 text-center"
            style={{
              opacity: dropped ? 0 : 1,
              pointerEvents: 'none',
              transition: 'opacity 0.4s ease',
            }}
          >
            <i
              className="absolute inset-4 rounded-2xl border-2 border-dashed transition-colors duration-300"
              style={{
                borderColor: frame.stage === 'dragging' ? 'var(--color-blue)' : 'transparent',
                background: frame.stage === 'dragging' ? 'rgb(122 162 247 / 0.05)' : 'transparent',
              }}
            />
            <div className="relative">
              <span className="mx-auto grid w-fit text-faint">
                <Glyph size={44}>{ICONS.vinyl}</Glyph>
              </span>
              <p className="mt-3.5 text-lg font-semibold text-fg">{t('home.drop.emptyTitle')}</p>
              <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-pretty text-muted">
                {t('home.drop.emptySubtitle')}
              </p>
              <span className="mt-4 inline-flex h-[34px] items-center rounded-lg bg-blue px-3.5 text-[13px] font-medium text-bg">
                {t('home.drop.addTracks')}
              </span>
            </div>
          </div>

          <div
            className="pointer-events-none absolute top-0 left-0 z-10 grid"
            style={{
              opacity: frame.stage === 'dragging' ? 1 : 0,
              transform: frame.stage === 'empty' ? 'translate(88%, 8%)' : 'translate(46%, 38%)',
              transition: `transform 0.9s cubic-bezier(0.645, 0.045, 0.355, 1), opacity 0.3s ease`,
              width: '100%',
              height: '100%',
            }}
          >
            {PILE.map((format, i) => (
              <span
                key={format}
                className="absolute grid h-[58px] w-[46px] place-items-end justify-center rounded-md border border-line bg-[#292e42] pb-1.5 font-mono text-[9px] font-semibold text-[#a9b1d6] shadow-lg shadow-black/40"
                style={{ transform: `rotate(${(i - 1) * 7}deg)` }}
              >
                {format}
              </span>
            ))}
            <i className="absolute -top-2 left-[34px] grid h-5 min-w-5 place-items-center rounded-full bg-red px-1.5 text-[11px] font-bold text-bg not-italic">
              {frame.total}
            </i>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="absolute top-[34px] left-[26px] size-[18px] drop-shadow"
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
        </div>
      </AppWindow>
    </div>
  )
}
