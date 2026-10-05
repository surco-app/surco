import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CRATE } from '../../lib/crate'
import { qualityFrame, SPECTRUM_WALL } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import {
  AppRow,
  AppWindow,
  ConvertButton,
  EditorFooter,
  Glyph,
  ICONS,
  SceneCursor,
  SearchBox,
  SectionTitle,
  Spinner,
  ToolbarButton,
} from './AppChrome'

const AXIS = ['20k', '15k', '10k', '5k']

// Two purchased FLACs: one genuine, one whose audio had already been through an MP3.
// The spectra are real captures on a linear frequency scale, where a codec cutoff is a
// straight edge you can point at.
const GENUINE = { ...CRATE.lasgo, src: '/spectrum/lossless-real.jpg' }
const FAKE = { ...CRATE.katty, src: '/spectrum/lossless-fake.jpg' }

// The app's audio quality section, opened on the genuine file, then the fake one is
// clicked and scanned until its codec wall shows and the verdict turns.
export default function QualityScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const fakeRow = useRef<HTMLDivElement>(null)
  const [target] = useState(() => fakeRow)
  const frame = qualityFrame(useSceneProgress(ref, 6500))
  const fake = frame.selected === 'fake'
  const bad = frame.verdict === 'bad'

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
        <div className="grid h-[440px] grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,15.5rem)_minmax(0,1fr)]">
          <div className="hidden overflow-hidden border-r border-line px-2 py-2.5 sm:block">
            <div className="mb-2.5">
              <SearchBox>{t('home.app.search')}</SearchBox>
            </div>
            <AppRow {...GENUINE} format="FLAC" selected={fake ? undefined : 'primary'} />
            <div ref={fakeRow}>
              <AppRow
                {...FAKE}
                format="FLAC"
                tone={bad ? 'bad' : 'good'}
                selected={fake ? 'primary' : undefined}
              />
            </div>
            <AppRow {...CRATE.tyfoon} format="WAV" />
          </div>

          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden px-6 pt-[18px]">
              <SectionTitle
                aside={
                  frame.verdict === 'analyzing' ? (
                    <>
                      <Spinner size={12} />
                      {t('home.quality.analyzing')}
                    </>
                  ) : (
                    <>
                      <i className={`block size-1.5 ${bad ? 'bg-red' : 'rounded-full bg-green'}`} />
                      <span className={bad ? 'text-red' : 'text-[#a9b1d6]'}>
                        {bad ? t('home.quality.bad') : t('home.quality.good')}
                      </span>
                    </>
                  )
                }
              >
                {t('home.quality.section')}
              </SectionTitle>

              <div className="relative mt-3 h-[260px] overflow-hidden rounded-lg bg-scrim">
                <img
                  src={GENUINE.src}
                  alt={t('home.quality.goodAlt')}
                  width={900}
                  height={245}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 size-full object-cover transition-opacity duration-300"
                  style={{ opacity: fake ? 0 : 1 }}
                />
                <img
                  src={FAKE.src}
                  alt={t('home.quality.fakeAlt')}
                  width={900}
                  height={245}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 size-full object-cover"
                  style={{ clipPath: `inset(0 0 ${(1 - frame.scan) * 100}% 0)` }}
                />
                <div className="absolute inset-y-0 left-0 flex w-9 flex-col justify-between bg-gradient-to-r from-scrim/70 to-transparent py-2 pl-2 font-mono text-[10px] leading-none text-[#a9b1d6]">
                  {AXIS.map((hz) => (
                    <span key={hz}>{hz}</span>
                  ))}
                </div>
                {fake && frame.scan < 1 && (
                  <span
                    className="absolute inset-x-0 h-px bg-fg"
                    style={{
                      top: `${frame.scan * 100}%`,
                      boxShadow: '0 0 10px 1px rgb(192 202 245 / 0.7)',
                    }}
                  />
                )}
                <span
                  className="absolute inset-x-0 top-0 border-b border-dashed border-red"
                  style={{
                    height: `${SPECTRUM_WALL * 100}%`,
                    opacity: frame.wall,
                    backgroundImage:
                      'repeating-linear-gradient(135deg, rgb(247 118 142 / 0.2) 0 5px, transparent 5px 10px)',
                  }}
                />
                <span
                  className="absolute top-1.5 right-1.5 rounded bg-scrim/75 px-1.5 py-0.5 text-[10px] text-fg transition-opacity duration-300"
                  style={{ opacity: frame.verdict === 'analyzing' ? 0 : 1 }}
                >
                  {bad ? t('home.quality.highsBad') : t('home.quality.highsGood')}
                </span>
              </div>

              <p className="mt-2.5 flex min-h-5 gap-2 text-[12.5px] text-[#a9b1d6]">
                {frame.verdict !== 'analyzing' && (
                  <>
                    <i className={`block w-0.5 flex-none rounded ${bad ? 'bg-red' : 'bg-green'}`} />
                    {bad ? t('home.quality.evidenceBad') : t('home.quality.evidenceGood')}
                  </>
                )}
              </p>
            </div>
            <EditorFooter>
              <ConvertButton label={t('home.app.convertTo')} />
            </EditorFooter>
          </div>
        </div>
        <SceneCursor container={win} target={frame.cursor ? target : null} />
      </AppWindow>
    </div>
  )
}
