import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISSUES_URL } from '../config'
import { PAGES } from '../lib/nav'
import { matchesUseCase, USE_CASE_SOURCES, type UseCaseSource } from '../lib/useCases'
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
  keywords: string
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
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<UseCaseSource | null>(null)
  const shown = cases.filter((c) => matchesUseCase(c, query, source))
  const filtering = shown.length < cases.length

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
            <nav aria-label={t('useCases.tocLabel')} className="mt-10">
              <label
                data-testid="use-case-search"
                className="flex h-12 items-center gap-3 rounded-xl border border-line bg-surface2 px-4 transition-colors focus-within:border-blue focus-within:ring-1 focus-within:ring-blue"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5 flex-none fill-none stroke-faint stroke-2"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-4-4" />
                </svg>
                <span className="sr-only">{t('useCases.searchLabel')}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('useCases.searchPlaceholder')}
                  className="h-full min-w-0 flex-1 bg-transparent text-base text-fg placeholder:text-faint focus-visible:outline-none!"
                />
                {filtering && (
                  <span aria-hidden="true" className="flex-none font-mono text-xs text-faint">
                    {t('useCases.shownCount', { shown: shown.length, total: cases.length })}
                  </span>
                )}
              </label>
              <p aria-live="polite" className="sr-only">
                {shown.length === 0
                  ? t('useCases.emptyTitle')
                  : filtering
                    ? t('useCases.shownCount', { shown: shown.length, total: cases.length })
                    : ''}
              </p>

              <fieldset className="-mx-6 mt-3 flex min-w-0 items-center gap-1 overflow-x-auto px-6 [scrollbar-width:none]">
                <legend className="sr-only">{t('useCases.sourcesLabel')}</legend>
                <span
                  aria-hidden="true"
                  className="mr-1 flex-none text-sm whitespace-nowrap text-faint"
                >
                  {t('useCases.sourcesLabel')}
                </span>
                {[null, ...USE_CASE_SOURCES].map((s) => (
                  <button
                    key={s ?? 'all'}
                    type="button"
                    data-testid="use-case-source"
                    aria-pressed={source === s}
                    onClick={() => setSource(s)}
                    className={`h-9 flex-none rounded-full border px-2.5 text-sm whitespace-nowrap transition-colors ${
                      source === s
                        ? 'border-blue bg-blue font-semibold text-bg'
                        : 'border-line text-muted hover:border-blue/50 hover:text-fg'
                    }`}
                  >
                    {s ? t(`useCases.sources.${s}`) : t('useCases.allSources')}
                  </button>
                ))}
              </fieldset>

              {shown.length === 0 ? (
                <div className="mt-8 rounded-xl border border-dashed border-line px-6 py-10 text-center">
                  <p className="text-fg">{t('useCases.emptyTitle')}</p>
                  <p className="mt-2 text-sm text-muted">{t('useCases.outroLede')}</p>
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <a
                      href={ISSUES_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="use-case-request"
                      className="text-sm font-semibold text-blue transition-colors hover:text-cyan"
                    >
                      {t('useCases.requestCase')}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('')
                        setSource(null)
                      }}
                      className="text-sm text-muted transition-colors hover:text-cyan"
                    >
                      {t('useCases.clearFilters')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-8 space-y-8">
                  {groups.map((group) => {
                    const items = shown.filter((c) => c.group === group.id)
                    if (items.length === 0) return null
                    return (
                      <div key={group.id}>
                        <p className="font-mono text-xs tracking-wider text-faint uppercase">
                          {group.title}
                        </p>
                        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
                          {items.map((c) => (
                            <li key={c.id}>
                              <a
                                href={`#${c.id}`}
                                data-testid="use-case-toc-item"
                                className="group flex items-start gap-4 bg-surface2/40 px-4 py-3.5 transition-colors hover:bg-surface2"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-medium text-fg">{c.title}</span>
                                    {c.macOnly && <MacBadge />}
                                  </span>
                                  <span className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                                    {c.body[0]}
                                  </span>
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="mt-0.5 flex-none text-faint transition-colors group-hover:text-blue"
                                >
                                  ›
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              )}
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

                  {c.related.length > 0 && (
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
                  )}
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
