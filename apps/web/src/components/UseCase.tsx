import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISSUES_URL } from '../config'
import type { Language } from '../i18n'
import { PAGES } from '../lib/nav'
import {
  DJ_PROGRAM_NAMES,
  type DjProgram,
  recipeIndex,
  recipePages,
  recipePathForId,
  settingGroups,
  settingShot,
  stepLead,
  USE_CASE_SHOTS,
} from '../lib/useCases'
import { NotesFold, StepList } from './Blocks'
import DownloadButton from './DownloadButton'
import Footer from './Footer'
import Header from './Header'
import Kicker from './Kicker'
import Lightbox from './Lightbox'
import Reveal from './Reveal'
import ScrollProgress from './ScrollProgress'

const SCREEN_WIDTH = 1440
const SCREEN_HEIGHT = 867

type Setting = {
  tab: string
  section?: string
  program?: DjProgram
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
  s: string
  body: string[]
  keywords: string
  shot?: string
  shotCaption?: string
  settings: Setting[]
  steps: Step[]
  points: string[]
  related: Related[]
}

export function UseCaseOutro() {
  const { t } = useTranslation()
  return (
    <section className="py-20 text-center sm:py-24">
      <Reveal>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
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
    <span className="inline-flex flex-none rounded-full border border-line px-2 py-0.5 text-xs font-medium whitespace-nowrap text-faint">
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
            <span className="rounded-full border border-line px-2 text-xs font-medium text-faint">
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

      <Header page="useCases" alternates={alternates} />

      <main
        id="main"
        className="relative mx-auto max-w-3xl px-6 sm:px-10 lg:grid lg:max-w-6xl lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16"
      >
        <aside className="hidden lg:block">
          <nav
            data-testid="use-case-side-index"
            aria-label={t('useCases.kicker')}
            className="sticky top-24 mt-16 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2"
          >
            <a
              href={PAGES.useCases[lang]}
              className="text-sm font-medium text-faint transition-colors hover:text-fg"
            >
              {t('useCases.kicker')}
            </a>
            {recipeIndex(groups, cases).map((g) => (
              <div key={g.id} className="mt-5">
                <p className="text-xs font-medium text-subtle">{g.title}</p>
                <ul className="mt-2 space-y-1.5">
                  {g.cases.map((o) => (
                    <li key={o.id}>
                      <a
                        href={recipePathForId(lang, o.id)}
                        aria-current={o.id === id ? 'page' : undefined}
                        className={`block text-[13px] leading-snug transition-colors ${o.id === id ? 'font-medium text-blue' : 'text-muted hover:text-fg'}`}
                      >
                        {o.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 max-w-3xl">
          <article data-testid="use-case" className="pt-12 pb-12 sm:pt-16">
            <Reveal eager>
              <a
                href={PAGES.useCases[lang]}
                data-testid="use-case-back"
                className="text-sm text-muted transition-colors hover:text-fg"
              >
                ‹ {t('useCases.backLabel')}
              </a>
              <div className="mt-8">
                <Kicker>{group?.title}</Kicker>
              </div>
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

              {c.shot && c.shotCaption && (
                <button
                  type="button"
                  data-testid="use-case-screen"
                  onClick={() => {
                    setShot({ src: `/${c.shot}`, caption: c.shotCaption ?? '' })
                    setShotOpen(true)
                  }}
                  className="mt-8 block w-full cursor-zoom-in overflow-hidden rounded-xl border border-line"
                >
                  <img
                    src={`/${c.shot}`}
                    alt={c.shotCaption}
                    width={SCREEN_WIDTH}
                    height={SCREEN_HEIGHT}
                    loading="lazy"
                    className="block h-auto w-full"
                  />
                </button>
              )}

              {c.settings.length > 0 && (
                <>
                  <p className="mt-10 text-sm font-medium text-faint">
                    {t('useCases.settingsLabel')}
                  </p>
                  <p className="mt-1 text-sm text-muted">{t('useCases.settingsHint')}</p>
                  {settingGroups(c.settings).map((group, i) => {
                    const src = settingShot(lang, c.id, i)
                    const [width, height] = USE_CASE_SHOTS[src] ?? []
                    const caption = [
                      t('useCases.settingsRoot'),
                      group.tab,
                      group.program && DJ_PROGRAM_NAMES[group.program],
                    ]
                      .filter(Boolean)
                      .join(' › ')
                    return (
                      <div key={caption} className="mt-5 border-t border-line pt-5">
                        <ul className="divide-y divide-line/60">
                          {group.settings.map((s) => (
                            <SettingRow key={`${s.tab}-${s.setting}`} s={s} />
                          ))}
                        </ul>
                        <details
                          data-testid="use-case-shot-fold"
                          className="mt-4 rounded-xl border border-line bg-surface2/40"
                        >
                          <summary className="cursor-pointer px-4 py-3 text-sm text-subtle">
                            {t('useCases.showShot', { place: caption })}
                          </summary>
                          <button
                            type="button"
                            data-testid="use-case-shot"
                            onClick={() => {
                              setShot({ src: `/use-cases/${src}`, caption })
                              setShotOpen(true)
                            }}
                            className="block w-full cursor-zoom-in overflow-hidden rounded-b-xl border-t border-line"
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
                        </details>
                      </div>
                    )
                  })}
                </>
              )}

              <p className="mt-10 text-sm font-medium text-faint">{t('useCases.stepsLabel')}</p>
              <StepList
                steps={c.steps.map((step) => ({
                  lead: stepLead(step.title, lang),
                  text: step.text,
                }))}
                itemTestid="use-case-step"
              />
              <NotesFold label={t('guide.notesLabel')} points={c.points} testid="use-case-notes" />

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
        </div>
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
