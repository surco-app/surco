import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CRATE } from '../../lib/crate'
import { TAG_JUNK_ARTIST, TAG_MATCHES, TAG_QUERY, TAG_TRACK, tagFrame } from '../../lib/scenes'
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
  SectionTitle,
  ToolbarButton,
} from './AppChrome'

// The app's three columns: the list with the badly tagged track selected, the search
// column where the query types in and the releases arrive, and the editor whose fields
// fill from the release once one of its tracks is clicked.
export default function TagScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const trackA = useRef<HTMLDivElement>(null)
  const [target] = useState(() => trackA)
  const frame = tagFrame(useSceneProgress(ref, 9000))
  const [album, year, genre] = frame.fields
  const fixed = frame.artist === TAG_TRACK.artist

  return (
    <div ref={ref}>
      <AppWindow
        windowRef={win}
        action={
          <ToolbarButton>
            <Glyph size={14}>{ICONS.convert}</Glyph>
            {t('home.app.convertCount', { count: 40 })}
          </ToolbarButton>
        }
      >
        <div className="grid h-[510px] grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="hidden overflow-hidden border-r border-line px-2 py-2.5 lg:block">
            <div className="mb-2.5">
              <SearchBox>{t('home.app.search')}</SearchBox>
            </div>
            <AppRow {...CRATE.lasgo} format="AIFF" />
            <AppRow
              title={TAG_TRACK.title}
              artist={fixed ? TAG_TRACK.artist : TAG_JUNK_ARTIST}
              duration={TAG_TRACK.duration}
              format="FLAC"
              cover={frame.artwork >= 1 ? TAG_TRACK.cover : undefined}
              selected="primary"
            />
            <AppRow {...CRATE.ivd} format="FLAC" />
          </div>

          <div className="hidden min-w-0 flex-col overflow-hidden border-r border-line md:flex">
            <div className="border-b border-line px-2.5 pt-2.5 pb-2">
              <SearchBox>
                <span className="text-fg">{frame.query}</span>
                {frame.query.length < TAG_QUERY.length && (
                  <i
                    className="-ml-1.5 block h-3.5 w-px bg-blue"
                    style={{ animation: 'glow 1s steps(1) infinite' }}
                  />
                )}
              </SearchBox>
              <p className="mt-1.5 flex h-4 items-center gap-1 text-xs text-muted">
                {frame.results > 0 && (
                  <>
                    {t('home.tag.all', {
                      count: frame.results === TAG_MATCHES.length ? 23 : frame.results,
                    })}
                    <Glyph size={12}>{ICONS.chevron}</Glyph>
                  </>
                )}
              </p>
            </div>
            <div className="p-1.5">
              {TAG_MATCHES.slice(0, frame.results).map((m, i) => (
                <div key={m.src} style={{ animation: `labelPop 0.3s ${EASE}` }}>
                  <div className="flex gap-2.5 rounded-lg p-2">
                    <span className="size-[30px] flex-none overflow-hidden rounded">
                      <Cover src={m.cover || undefined} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-fg">{m.title}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                        <b className="font-semibold text-[#a9b1d6]">{m.src}</b>
                        {i === 0 && frame.picked && (
                          <span className="text-blue">
                            <Glyph size={11}>{ICONS.sparkle}</Glyph>
                          </span>
                        )}
                        {m.meta}
                      </span>
                    </span>
                  </div>
                  {i === 0 && frame.open && (
                    <div
                      ref={trackA}
                      className={`ml-2 flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors duration-300 ${
                        frame.picked ? 'bg-blue/30' : ''
                      }`}
                      style={{ animation: `labelPop 0.3s ${EASE}` }}
                    >
                      <span className="w-[18px] text-xs text-faint">A</span>
                      <span className="min-w-0 flex-1 truncate text-fg">{TAG_TRACK.title}</span>
                      {frame.picked && (
                        <span className="text-blue">
                          <Glyph size={13}>{ICONS.sparkle}</Glyph>
                        </span>
                      )}
                      <span className="text-xs text-muted tabular-nums">{TAG_TRACK.duration}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden px-6 pt-[18px]">
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
                <div className="hidden sm:block">
                  <span className="relative block size-24 overflow-hidden rounded-lg bg-[#292e42]">
                    <span className="absolute inset-0 grid place-items-center text-faint">
                      <Glyph size={22}>{ICONS.image}</Glyph>
                    </span>
                    <span
                      className="absolute inset-0"
                      style={{
                        opacity: frame.artwork,
                        transform: `scale(${0.94 + 0.06 * frame.artwork})`,
                      }}
                    >
                      <Cover src={TAG_TRACK.cover} />
                    </span>
                  </span>
                  <p className="mt-2 text-center text-[11px] text-muted tabular-nums">
                    {frame.artwork >= 1 ? '1/2' : '0/0'}
                  </p>
                  {frame.artwork >= 1 && (
                    <p className="mt-0.5 flex items-center justify-center gap-1.5 text-[11px] text-muted tabular-nums">
                      <i className="block size-1.5 rounded-full bg-green" />
                      600 × 600 px
                    </p>
                  )}
                </div>
                <div>
                  <AppField label={t('home.app.fieldTitle')}>{TAG_TRACK.title}</AppField>
                  <AppField label={t('home.app.fieldArtist')} flash={frame.picked && !fixed}>
                    <span className={frame.picked ? 'text-fg' : 'text-muted'}>{frame.artist}</span>
                  </AppField>
                  <AppField label={t('home.app.fieldAlbum')} flash={!!album && !year}>
                    {album}
                  </AppField>
                  <AppField label={t('home.app.fieldYear')} short flash={!!year && !genre}>
                    {year}
                  </AppField>
                  <AppField label={t('home.app.fieldGenre')}>{genre}</AppField>
                </div>
              </div>
            </div>
            <EditorFooter>
              <ConvertButton label={t('home.app.convertTo')} />
            </EditorFooter>
          </div>
        </div>
        <SceneCursor
          container={win}
          target={frame.open && !(frame.picked && fixed) ? target : null}
        />
      </AppWindow>
    </div>
  )
}
