import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BATCH_QUEUE, BATCH_TOTAL, batchFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import {
  AppField,
  AppRow,
  AppWindow,
  ConvertButton,
  EASE,
  EditorFooter,
  Glyph,
  ICONS,
  SceneCursor,
  SearchBox,
  SectionTitle,
  Spinner,
  ToolbarButton,
} from './AppChrome'

const GENRES = ['Euro House', 'Trance', 'Electronic']

// The whole selection in the multi-track editor, converted with one press: each row's
// ring turns in order while the toolbar counts, and the footer reports the tracks in
// Apple Music once every one has landed there.
export default function BatchScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLDivElement>(null)
  const [target] = useState(() => button)
  const frame = batchFrame(useSceneProgress(ref, 7500))
  const running = frame.states.some((s) => s !== 'idle') && !frame.finished

  return (
    <div ref={ref}>
      <AppWindow
        windowRef={win}
        action={
          running ? (
            <ToolbarButton>
              <Spinner size={13} />
              <span className="tabular-nums">
                {t('home.batch.converting', { done: frame.done, total: BATCH_TOTAL })}
              </span>
            </ToolbarButton>
          ) : (
            <ToolbarButton quiet={frame.finished}>
              <Glyph size={14}>{ICONS.convert}</Glyph>
              {frame.finished
                ? t('home.batch.converted', { count: BATCH_TOTAL })
                : t('home.app.convertCount', { count: BATCH_TOTAL })}
            </ToolbarButton>
          )
        }
      >
        <div className="grid h-[440px] grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,15.5rem)_minmax(0,1fr)]">
          <div className="hidden overflow-hidden border-r border-line px-2 py-2.5 sm:block">
            <div className="mb-2.5">
              <SearchBox>{t('home.app.search')}</SearchBox>
            </div>
            {BATCH_QUEUE.map((track, i) => {
              const state = frame.states[i]
              return (
                <AppRow
                  key={track.title}
                  {...track}
                  format="AIFF"
                  selected="multi"
                  stage={state === 'working' ? t('home.batch.stage') : null}
                  ring={state === 'working' ? Math.round(frame.rowProgress * 100) : null}
                  done={state === 'done'}
                />
              )
            })}
          </div>

          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden px-6 pt-[18px]">
              <p className="flex items-center gap-2.5 text-xs text-muted">
                {t('home.app.file')}
                <span className="h-px flex-1 bg-line" />
              </p>
              <div className="mt-4">
                <SectionTitle>{t('home.batch.editing', { count: BATCH_TOTAL })}</SectionTitle>
              </div>
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-[18px] sm:grid-cols-[96px_minmax(0,1fr)]">
                <span className="hidden size-24 place-items-center rounded-lg bg-[#292e42] text-faint sm:grid">
                  <Glyph size={22}>{ICONS.image}</Glyph>
                </span>
                <div>
                  <AppField label={t('home.app.fieldArtist')}>
                    <span className="text-muted">{t('home.batch.mixed')}</span>
                  </AppField>
                  <AppField label={t('home.app.fieldAlbum')}>
                    <span className="text-muted">{t('home.batch.mixed')}</span>
                  </AppField>
                  <p className="mb-1.5 text-[12.5px] text-muted">{t('home.batch.genreAll')}</p>
                  <p className="flex flex-wrap gap-1.5">
                    {GENRES.map((genre, i) => (
                      <span
                        key={genre}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          i === 0
                            ? 'border-blue bg-blue/15 text-blue'
                            : 'border-line text-[#a9b1d6]'
                        }`}
                      >
                        {genre}
                      </span>
                    ))}
                  </p>
                </div>
              </div>
            </div>

            <EditorFooter>
              <div
                className="absolute inset-0 flex items-center px-[22px]"
                style={{
                  opacity: frame.finished ? 0 : 1,
                  transform: frame.finished ? 'translateY(8px)' : 'none',
                  transition: `opacity 0.3s ease, transform 0.45s ${EASE}`,
                }}
              >
                <ConvertButton
                  buttonRef={button}
                  pressed={frame.pressed}
                  progress={running ? (frame.done / BATCH_TOTAL) * 100 : null}
                  label={t('home.batch.button', { count: BATCH_TOTAL })}
                />
              </div>
              <p
                className="absolute inset-0 flex items-center px-[22px] text-xs font-medium text-green"
                style={{
                  opacity: frame.finished ? 1 : 0,
                  transform: frame.finished ? 'none' : 'translateY(-8px)',
                  transition: `opacity 0.3s ease, transform 0.45s ${EASE}`,
                }}
              >
                {t('home.batch.added', { count: BATCH_TOTAL })}
              </p>
            </EditorFooter>
          </div>
        </div>
        <SceneCursor container={win} target={frame.cursor ? target : null} />
      </AppWindow>
    </div>
  )
}
