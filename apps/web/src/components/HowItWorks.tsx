import { useTranslation } from 'react-i18next'
import Icon, { type GlyphName } from './Icon'
import Kicker from './Kicker'
import Reveal from './Reveal'

// One glyph per step: drop the files, pick the release, export.
const STEP_ICONS: GlyphName[] = ['download', 'disc', 'check']

export default function HowItWorks() {
  const { t, i18n } = useTranslation()
  const steps = t('how.steps', { returnObjects: true }) as { title: string; body: string }[]
  const guideHref = i18n.language === 'en' ? '/en/guide' : '/guia'

  return (
    <section id="como" className="scroll-mt-24 pb-24">
      <Reveal>
        <Kicker>{t('how.kicker')}</Kicker>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{t('how.title')}</h2>
      </Reveal>

      <div className="relative mt-12 grid gap-8 md:grid-cols-3">
        <div className="pointer-events-none absolute top-6 right-8 left-8 hidden h-px bg-gradient-to-r from-transparent via-line to-transparent md:block" />
        {steps.map((s, i) => (
          <Reveal key={s.title} delay={i * 120}>
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-blue/40 bg-bg text-blue">
                <Icon name={STEP_ICONS[i]} className="size-5" />
              </div>
              <div className="mt-5 flex items-center gap-2">
                <span className="font-mono text-xs text-faint">0{i + 1}</span>
                <h3 className="text-lg font-semibold text-fg">{s.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <a
          href={guideHref}
          className="mt-10 inline-flex items-center text-sm font-medium text-fg transition-colors hover:text-blue"
        >
          {t('how.guideCta')}
        </a>
      </Reveal>
    </section>
  )
}
