import { useTranslation } from 'react-i18next'
import { PAGES } from '../lib/nav'
import DownloadButton from './DownloadButton'
import Footer from './Footer'
import Header from './Header'
import Reveal from './Reveal'
import ScrollProgress from './ScrollProgress'

type Setting = {
  tab: string
  section?: string
  setting: string
  value?: string
  optional?: boolean
  note: string
}
type Step = { title: string; text: string }
type Related = { label: string; anchor: string }
type Group = { id: string; title: string; lede: string }
type UseCase = {
  id: string
  group: string
  macOnly?: boolean
  title: string
  body: string[]
  settings: Setting[]
  steps: Step[]
  points: string[]
  related: Related[]
}

function MacBadge() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex flex-none rounded-full border border-line px-2 py-0.5 font-mono text-[10px] tracking-wider whitespace-nowrap text-faint uppercase">
      {t('useCases.macOnly')}
    </span>
  )
}

function SettingRow({ s }: { s: Setting }) {
  const { t } = useTranslation()
  const path = [t('useCases.settingsRoot'), s.tab, s.section, s.setting].filter(Boolean)
  return (
    <li data-testid="use-case-setting" className="border-t border-line/60 px-5 py-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
        {path.map((part, i) => (
          <span key={part} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="text-faint">
                ›
              </span>
            )}
            <span className={i === path.length - 1 ? 'font-semibold text-fg' : 'text-muted'}>
              {part}
            </span>
          </span>
        ))}
        <span aria-hidden="true" className="text-faint">
          ›
        </span>
        <span className="rounded-md border border-cyan/25 bg-cyan/10 px-2 py-0.5 font-mono text-xs text-cyan">
          {s.value ?? t('useCases.on')}
        </span>
        {s.optional && (
          <span className="rounded-full border border-line px-2 font-mono text-[10px] tracking-wider text-faint uppercase">
            {t('useCases.optional')}
          </span>
        )}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.note}</p>
    </li>
  )
}

export default function UseCases() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'es'
  const guideHref = PAGES.guide[lang]
  const cases = t('useCases.cases', { returnObjects: true }) as UseCase[]
  const groups = t('useCases.groups', { returnObjects: true }) as Group[]
  const casesIn = (group: Group) => cases.filter((c) => c.group === group.id)

  return (
    <div id="top" className="min-h-screen bg-bg text-fg antialiased">
      <ScrollProgress />
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background:
            'radial-gradient(55% 50% at 72% 4%, rgba(122,162,247,0.18) 0%, rgba(26,27,38,0) 70%)',
        }}
      />

      <Header page="useCases" />

      <main id="main" className="relative mx-auto max-w-3xl px-6">
        <section className="pt-12 pb-4 sm:pt-16">
          <Reveal eager>
            <p className="font-mono text-xs tracking-wider text-blue uppercase">
              {t('useCases.kicker')}
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-5xl">
              {t('useCases.title')}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{t('useCases.lede')}</p>
          </Reveal>

          <Reveal eager delay={120}>
            <nav aria-label={t('useCases.tocLabel')} className="mt-10 space-y-8">
              {groups.map((group) => (
                <div key={group.id}>
                  <p className="font-mono text-xs tracking-wider text-faint uppercase">
                    {group.title}
                  </p>
                  <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
                    {casesIn(group).map((c) => (
                      <li key={c.id} className="min-w-0">
                        <a
                          href={`#${c.id}`}
                          data-testid="use-case-toc-item"
                          className="flex h-full items-start justify-between gap-3 rounded-xl border border-line bg-surface2/40 px-4 py-3 text-sm text-muted transition-colors hover:border-blue/50 hover:text-fg"
                        >
                          <span>{c.title}</span>
                          {c.macOnly && <MacBadge />}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </Reveal>
        </section>

        {groups.map((group) => (
          <div key={group.id} id={group.id} data-testid="use-case-group" className="scroll-mt-20">
            <div className="border-t border-line/60 pt-14 pb-2">
              <h2 className="font-mono text-xs tracking-wider text-blue uppercase">
                {group.title}
              </h2>
              <p className="mt-2 max-w-2xl text-lg leading-relaxed text-muted">{group.lede}</p>
            </div>
            {casesIn(group).map((c) => (
              <section
                key={c.id}
                id={c.id}
                data-testid="use-case"
                className="scroll-mt-20 border-t border-line/60 py-12"
              >
                <Reveal>
                  <h3 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                    {c.title}
                  </h3>
                  {c.macOnly && (
                    <p className="mt-3">
                      <MacBadge />
                    </p>
                  )}
                  {c.body.map((p) => (
                    <p key={p} className="mt-4 max-w-2xl leading-relaxed text-muted">
                      {p}
                    </p>
                  ))}

                  {c.settings.length > 0 && (
                    <div className="mt-8 overflow-hidden rounded-2xl border border-line">
                      <div className="bg-surface2 px-5 py-3">
                        <p className="font-mono text-xs tracking-wider text-faint uppercase">
                          {t('useCases.settingsLabel')}
                        </p>
                        <p className="mt-1 text-sm text-muted">{t('useCases.settingsHint')}</p>
                      </div>
                      <ul>
                        {c.settings.map((s) => (
                          <SettingRow key={`${s.tab}-${s.setting}`} s={s} />
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="mt-10 font-mono text-xs tracking-wider text-faint uppercase">
                    {t('useCases.stepsLabel')}
                  </p>
                  <ol className="mt-4 space-y-5">
                    {c.steps.map((step, i) => (
                      <li key={step.title} data-testid="use-case-step" className="flex gap-4">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-blue font-mono text-sm text-blue">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold">{step.title}</p>
                          <p className="mt-0.5 text-sm leading-relaxed text-muted">{step.text}</p>
                        </div>
                      </li>
                    ))}
                  </ol>

                  <ul className="mt-8 space-y-2.5">
                    {c.points.map((point) => (
                      <li key={point} className="flex gap-3 text-sm leading-relaxed text-muted">
                        <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-8 text-sm text-faint">
                    {t('useCases.relatedLabel')}{' '}
                    {c.related.map((r, i) => (
                      <span key={r.anchor}>
                        {i > 0 && ' · '}
                        <a
                          href={`${guideHref}#${r.anchor}`}
                          className="text-blue transition-colors hover:text-cyan"
                        >
                          {r.label}
                        </a>
                      </span>
                    ))}
                  </p>
                </Reveal>
              </section>
            ))}
          </div>
        ))}

        <section className="border-t border-line/60 py-16 text-center">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('useCases.outroTitle')}
            </h2>
            <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted">
              {t('useCases.outroLede')}
            </p>
            <div className="mt-2 flex flex-col items-center text-center">
              <DownloadButton location="use-cases" />
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
