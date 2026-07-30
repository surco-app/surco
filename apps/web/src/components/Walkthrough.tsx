import { useTranslation } from 'react-i18next'
import { PAGES } from '../lib/nav'
import {
  DECLICK_ENVELOPE,
  DECLICK_MARKS,
  TAIL_CUT,
  TAIL_ENVELOPE,
  TRACK_ENVELOPE,
} from '../lib/waveforms'
import Kicker from './Kicker'
import Reveal from './Reveal'
import AppFrame from './scenes/AppFrame'
import SceneLayout from './scenes/SceneLayout'
import SpectrumPair from './scenes/SpectrumPair'
import TrackRows from './scenes/TrackRows'
import WaveStrip from './scenes/WaveStrip'

const DESTINATIONS = ['rekordbox', 'Engine DJ', 'Traktor', 'Serato', 'Apple Music', 'M3U8']

// The six steps a file goes through, in order, each one showing the part of the app
// that does it. The page sells the whole preparation flow, so it walks the flow
// rather than listing features — and the app is on screen in every scene.
export default function Walkthrough() {
  const { t, i18n } = useTranslation()
  const guideHref = PAGES.guide[i18n.language === 'en' ? 'en' : 'es']

  return (
    <>
      <Reveal>
        <div id="como" className="scroll-mt-24 pt-24 text-center">
          <div className="flex justify-center">
            <Kicker>{t('home.walkthrough.kicker')}</Kicker>
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t('home.walkthrough.title')}
          </h2>
          <p className="mx-auto mt-3 max-w-xl leading-relaxed text-pretty text-muted">
            {t('home.walkthrough.lede')}
          </p>
        </div>
      </Reveal>

      <SceneLayout
        step={t('home.drop.step')}
        title={t('home.drop.title')}
        app={
          <AppFrame pill={t('home.drop.pill')} busy progress={66}>
            <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <TrackRows
                rows={[
                  { name: 'Kaleidos - Take Me To The Limit', format: 'FLAC' },
                  { name: 'Kalura - Pay For Love', state: 'loading', format: 'FLAC' },
                  { name: 'Karen B - Natural Woman', state: 'loading', format: 'FLAC' },
                  { name: 'Ken Laszlo - When I Fall In Love', state: 'loading', format: 'FLAC' },
                  { name: 'Kim Sanders - Ride', state: 'loading', format: 'FLAC' },
                  { name: 'Kriss - Tonight', state: 'loading', format: 'FLAC' },
                ]}
              />
              <div className="hidden items-center justify-center border-l border-line p-4 text-center font-mono text-xs text-faint sm:flex">
                {t('home.drop.caption')}
              </div>
            </div>
          </AppFrame>
        }
      >
        {t('home.drop.lede')}
      </SceneLayout>

      <SceneLayout
        flip
        step={t('home.quality.step')}
        title={t('home.quality.title')}
        app={
          <AppFrame pill={t('home.quality.pill')}>
            <SpectrumPair />
          </AppFrame>
        }
      >
        <p>{t('home.quality.lede')}</p>
        <p className="mt-3 font-mono text-xs text-faint">{t('home.quality.note')}</p>
      </SceneLayout>

      <SceneLayout
        step={t('home.tag.step')}
        title={t('home.tag.title')}
        app={
          <AppFrame pill={t('home.tag.pill')} busy progress={30}>
            <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
              <div className="space-y-1.5">
                {[
                  { title: 'When I Fall In Love', meta: '1995 · Factory Team · FT-012', src: 'Discogs', on: true },
                  { title: 'Euro Club Vol. 3', meta: '1995 · Rise', src: 'Deezer' },
                  { title: 'When I Fall In Love', meta: '1996 · self-released', src: 'Bandcamp' },
                ].map((r) => (
                  <div
                    key={r.src}
                    className={`flex items-center gap-2 rounded-lg border p-2 font-mono text-[11px] ${
                      r.on ? 'border-blue/45 bg-blue/10' : 'border-line'
                    }`}
                  >
                    <span className="size-7 shrink-0 rounded bg-surface" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-fg/90">{r.title}</span>
                      <span className="block truncate text-[10px] text-faint">{r.meta}</span>
                    </span>
                    <span className="shrink-0 rounded-full border border-line px-1.5 text-[9px] text-faint">
                      {r.src}
                    </span>
                  </div>
                ))}
              </div>
              <div className="space-y-2 font-mono text-[11px]">
                <div className="rounded-lg border border-red/45 bg-bg/60 p-2">
                  <span className="block text-[9px] tracking-wider text-faint uppercase">
                    {t('home.tag.before')}
                  </span>
                  <span className="mt-1 block break-all text-red">
                    2-2-2c-2e-1-2c-2e-1-2y4c-EF
                  </span>
                </div>
                <div className="rounded-lg border border-green/45 bg-bg/60 p-2">
                  <span className="block text-[9px] tracking-wider text-faint uppercase">
                    {t('home.tag.after')}
                  </span>
                  <span className="mt-1 block text-green">Lil Suzy</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Sello', 'Factory Team'],
                    ['BPM', '135'],
                    ['Tono', 'Fm · 9A'],
                    ['Año', '1995'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-line bg-bg/60 p-2">
                      <span className="block text-[9px] tracking-wider text-faint uppercase">
                        {k}
                      </span>
                      <span className="mt-1 block truncate text-fg/90">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </AppFrame>
        }
      >
        <p>{t('home.tag.lede')}</p>
        <p className="mt-3 font-mono text-xs text-faint">{t('home.tag.note')}</p>
      </SceneLayout>

      <SceneLayout
        flip
        step={t('home.declick.step')}
        title={t('home.declick.title')}
        app={
          <AppFrame pill={t('home.declick.pill')}>
            <div className="p-5">
              <WaveStrip
                values={DECLICK_ENVELOPE}
                marks={DECLICK_MARKS}
                playhead={0.54}
                height="h-32"
                label={t('home.declick.title')}
              />
              <div className="mt-4 flex items-center gap-3">
                <span className="inline-flex overflow-hidden rounded-lg border border-line font-mono text-[11px]">
                  <span className="bg-blue/20 px-3 py-1.5 text-blue">
                    {t('home.declick.hearing')}
                  </span>
                  <span className="px-3 py-1.5 text-muted">{t('home.declick.original')}</span>
                </span>
              </div>
            </div>
          </AppFrame>
        }
      >
        {t('home.declick.lede')}
      </SceneLayout>

      <SceneLayout
        step={t('home.trim.step')}
        title={t('home.trim.title')}
        app={
          <AppFrame pill={t('home.trim.pill')}>
            <div className="p-5">
              <WaveStrip
                values={TAIL_ENVELOPE}
                cut={TAIL_CUT}
                height="h-32"
                label={t('home.trim.tailLabel')}
              />
              <div className="mt-4 flex items-baseline justify-between font-mono text-[10px]">
                <span className="text-cyan">{t('home.trim.magnet')}</span>
                <span className="text-faint">{t('home.trim.tailLabel')}</span>
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <WaveStrip
                  values={TRACK_ENVELOPE}
                  height="h-12"
                  label={t('home.trim.fullLabel')}
                />
                <p className="mt-2 font-mono text-[10px] text-faint">{t('home.trim.fullLabel')}</p>
              </div>
            </div>
          </AppFrame>
        }
      >
        {t('home.trim.lede')}
      </SceneLayout>

      <SceneLayout
        wide
        step={t('home.batch.step')}
        title={t('home.batch.title')}
        app={
          <AppFrame pill={t('home.batch.pill')} busy progress={28}>
            <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <TrackRows
                rows={[
                  { name: 'Jill Dreski - Let Me Know', state: 'done', format: 'AIFF' },
                  { name: 'Jo-Ann - Always', state: 'done', format: 'AIFF' },
                  {
                    name: 'Ken Laszlo - When I Fall In Love',
                    state: 'working',
                    stage: t('home.batch.stage'),
                    progress: 64,
                    selected: true,
                  },
                  { name: 'Kim Sanders - Ride', state: 'flagged', format: 'WAV' },
                  { name: 'Kriss - Tonight', format: 'FLAC' },
                ]}
              />
              <div className="border-t border-line p-5 lg:border-t-0 lg:border-l">
                <div className="relative overflow-hidden rounded-lg bg-blue/20 px-3 py-2 font-mono text-[11px]">
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 bg-blue/30"
                    style={{ width: '64%' }}
                  />
                  <span className="relative flex justify-between">
                    <span className="text-fg">{t('home.batch.stage')}</span>
                    <span className="text-faint">{t('home.batch.cancel')}</span>
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {DESTINATIONS.map((d, i) => (
                    <span
                      key={d}
                      className={`rounded border px-2.5 py-1.5 font-mono text-[10px] ${
                        i === 0 ? 'border-blue/45 bg-blue/10 text-blue' : 'border-line text-muted'
                      }`}
                    >
                      {d}
                    </span>
                  ))}
                </div>
                <p className="mt-3 font-mono text-[10px] text-green">{t('home.batch.cues')}</p>
                <p className="mt-1.5 font-mono text-[10px] text-faint">
                  {t('home.batch.summary')}
                </p>
              </div>
            </div>
          </AppFrame>
        }
      >
        {t('home.batch.lede')}
      </SceneLayout>

      <Reveal>
        <a
          href={guideHref}
          className="inline-flex items-center text-sm font-medium text-fg transition-colors hover:text-blue"
        >
          {t('how.guideCta')}
        </a>
      </Reveal>
    </>
  )
}
