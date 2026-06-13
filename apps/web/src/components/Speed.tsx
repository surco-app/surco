import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'

const TIMES = ['~45 s', '~45 s', '~60 s', '~90 s', '~30 s']

export default function Speed() {
  const { t } = useTranslation()
  const manualSteps = t('speed.manualSteps', { returnObjects: true }) as { app: string; label: string }[]
  const bullets = t('speed.bullets', { returnObjects: true }) as string[]

  return (
    <section id="velocidad" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('speed.kicker')}</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t('speed.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('speed.lede')}</p>
      </Reveal>

      <div className="mt-10 grid items-stretch gap-5 md:grid-cols-2">
        <Reveal>
          <div className="inset-shadow-edge h-full rounded-2xl border border-line bg-surface2/40 p-6">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-fg">{t('speed.manual')}</span>
              <span className="font-mono text-sm text-red">{t('speed.manualTime')}</span>
            </div>
            <ul className="mt-4 space-y-2.5">
              {manualSteps.map((s, i) => (
                <li key={s.label} className="flex items-center gap-3 rounded-lg bg-bg/50 px-3 py-2">
                  <span className="font-mono text-[10px] text-faint">{TIMES[i]}</span>
                  <span className="text-sm text-fg">{s.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-faint">{s.app}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-bg">
              <div className="h-full rounded-full bg-red/70" style={{ animation: 'fillSlow 6s linear infinite' }} />
            </div>
            <p className="mt-2 font-mono text-[10px] text-faint">{t('speed.manualCaption')}</p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="inset-shadow-edge relative h-full overflow-hidden rounded-2xl border border-blue/40 bg-surface2/40 p-6 transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-blue/5">
            <div
              className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-blue/15 blur-2xl"
              style={{ animation: 'glow 4s ease-in-out infinite' }}
            />
            <div className="relative flex items-baseline justify-between">
              <span className="text-sm font-semibold text-fg">{t('speed.withSurco')}</span>
              <span className="font-mono text-sm text-cyan">{t('speed.withSurcoTime')}</span>
            </div>
            <div className="relative mt-4 flex items-center gap-3 rounded-xl border border-blue/40 bg-blue/10 px-4 py-3">
              <span className="font-mono text-xs text-blue">▶</span>
              <span className="text-sm font-medium text-fg">{t('speed.combo')}</span>
              <span className="ml-auto text-green" style={{ animation: 'popcheck 6s ease-out infinite' }}>
                ✓
              </span>
            </div>
            <ul className="relative mt-4 grid grid-cols-2 gap-2 font-mono text-[11px] text-muted">
              {bullets.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>
            <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue to-cyan"
                style={{ animation: 'fillSnap 6s ease-out infinite' }}
              />
            </div>
            <p className="relative mt-2 font-mono text-[10px] text-faint">{t('speed.oneClick')}</p>
          </div>
        </Reveal>
      </div>

      <p className="mt-4 font-mono text-[11px] text-faint">{t('speed.footnote')}</p>
    </section>
  )
}
