import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISSUES_URL } from '../config'
import type { Language } from '../i18n'
import { PAGES } from '../lib/nav'
import { recipePages, settingGroups, settingShot, USE_CASE_SHOTS } from '../lib/useCases'
import DownloadButton from './DownloadButton'
import Footer from './Footer'
import Header from './Header'
import Lightbox from './Lightbox'
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
export type Group = { id: string; title: string; lede: string }
export type UseCase = {
  id: string
  slug: string
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

export function UseCaseOutro() {
  const { t } = useTranslation()
  return (
    <section className="border-t border-line/60 py-16 text-center">
      <Reveal>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('useCases.outroTitle')}
        </h2>
        <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted">
          {t('useCases.outroLede')}
        </p>
        <a
          href={ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="use-case-outro-request"
          className="mt-3 inline-block text-sm font-semibold text-blue transition-colors hover:text-cyan"
        >
          {t('useCases.requestCase')}
        </a>
        <div className="mt-2 flex flex-col items-center text-center">
          <DownloadButton location="use-cases" />
        </div>
      </Reveal>
    </section>
  )
}

export function MacBadge() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex flex-none rounded-full border border-line px-2 py-0.5 font-mono text-[10px] tracking-wider whitespace-nowrap text-faint uppercase">
      {t('useCases.macOnly')}
    </span>
  )
}

function SettingRow({ s }: { s: Setting & { n: number } }) {
  const { t } = useTranslation()
  const path = [t('useCases.settingsRoot'), s.tab, s.section, s.setting].filter(Boolean)
  return (
    <li data-testid="use-case-setting" className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <span className="mt-px flex h-6 w-6 flex-none items-center justify-center rounded-full bg-amber font-mono text-xs font-bold text-bg">
        {s.n}
      </span>
      <div className="min-w-0">
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
      </div>
    </li>
  )
}

export default function UseCasePage({ id }: { id: string }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language as Language
  const guideHref = PAGES.guide[lang]
  const cases = t('useCases.cases', { returnObjects: true }) as UseCase[]
  const groups = t('useCases.groups', { returnObjects: true }) as Group[]
  const c = cases.find((o) => o.id === id) as UseCase
  const group = groups.find((g) => g.id === c.group)
  const alternates = recipePages().find((page) => page.lang === lang && page.id === id)?.alternates
  const [shot, setShot] = useState<{ src: string; caption: string } | null>(null)
  const [shotOpen, setShotOpen] = useState(false)

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

      <Header page="useCases" alternates={alternates} />

      <main id="main" className="relative mx-auto max-w-3xl px-6">
        <article data-testid="use-case" className="pt-12 pb-12 sm:pt-16">
          <Reveal eager>
            <a
              href={PAGES.useCases[lang]}
              data-testid="use-case-back"
              className="text-sm text-muted transition-colors hover:text-fg"
            >
              ‹ {t('useCases.backLabel')}
            </a>
            <p className="mt-8 font-mono text-xs tracking-wider text-blue uppercase">
              {group?.title}
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-5xl">
              {c.title}
            </h1>
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
                {settingGroups(c.settings).map((group, i) => {
                  const src = settingShot(lang, c.id, i)
                  const [width, height] = USE_CASE_SHOTS[src] ?? []
                  const caption = `${t('useCases.settingsRoot')} › ${group.tab}`
                  return (
                    <div key={group.tab} className="border-t border-line/60 px-5 py-5">
                      <button
                        type="button"
                        data-testid="use-case-shot"
                        onClick={() => {
                          setShot({ src: `/use-cases/${src}`, caption })
                          setShotOpen(true)
                        }}
                        className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-line"
                      >
                        <img
                          src={`/use-cases/${src}`}
                          alt={caption}
                          width={width}
                          height={height}
                          loading="lazy"
                          className="block h-auto w-full"
                        />
                      </button>
                      <ul className="mt-5 divide-y divide-line/60">
                        {group.settings.map((s) => (
                          <SettingRow key={`${s.tab}-${s.setting}`} s={s} />
                        ))}
                      </ul>
                    </div>
                  )
                })}
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
        </article>

        <UseCaseOutro />
      </main>

      <Lightbox
        open={shotOpen}
        src={shot?.src ?? null}
        alt={shot?.caption ?? ''}
        caption={shot?.caption}
        closeLabel={t('lightbox.close')}
        onClose={() => setShotOpen(false)}
      />

      <Footer />
    </div>
  )
}
