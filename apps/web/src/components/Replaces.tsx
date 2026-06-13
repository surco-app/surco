import { useTranslation } from 'react-i18next'
import CountUp from './CountUp'
import Reveal from './Reveal'

export default function Replaces() {
  const { t } = useTranslation()
  const apps = t('replaces.apps', { returnObjects: true }) as string[]

  return (
    <section id="reemplaza" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('replaces.kicker')}</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t('replaces.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('replaces.lede')}</p>
      </Reveal>

      <div className="mt-10 grid items-center gap-6 md:grid-cols-[1fr_auto_1fr]">
        <Reveal from="left">
          <ul className="grid gap-2.5">
            {apps.map((a) => (
              <li
                key={a}
                className="flex items-center justify-between rounded-xl border border-line bg-surface2/30 px-4 py-2.5"
              >
                <span className="text-sm text-muted">{a}</span>
                <span className="font-mono text-xs text-red/70">✕</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <div className="flex items-center justify-center" aria-hidden="true">
          <span className="rotate-90 font-mono text-3xl text-cyan md:rotate-0">→</span>
        </div>

        <Reveal from="right" delay={120}>
          <div className="inset-shadow-edge relative overflow-hidden rounded-2xl border border-blue/40 bg-surface2/40 p-6">
            <div
              className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-blue/15 blur-2xl"
              style={{ animation: 'glow 4s ease-in-out infinite' }}
            />
            <div className="relative text-3xl font-bold text-grad">Surco</div>
            <p className="relative mt-1 text-sm text-muted">{t('replaces.result')}</p>
            <div className="relative mt-6 flex gap-8">
              <div>
                <div className="text-3xl font-bold text-fg tabular-nums">
                  ~<CountUp to={100} />×
                </div>
                <p className="mt-1 text-xs text-muted">{t('replaces.faster')}</p>
              </div>
              <div>
                <div className="text-3xl font-bold text-fg tabular-nums">1–2 s</div>
                <p className="mt-1 text-xs text-muted">{t('replaces.perTrack')}</p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
