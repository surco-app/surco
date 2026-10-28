import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DONATE_URL } from '../config'
import { LANGUAGE_NAMES, LANGUAGES, type Language } from '../i18n'
import { trackDonate } from '../lib/analytics'
import { isCondensed, showsHeaderDownload } from '../lib/header'
import { HEADER_SECTIONS, HOME, PAGES, type Page } from '../lib/nav'
import { btnPrimary } from '../lib/ui'
import { rememberLanguage, useAutoLanguage } from '../lib/useAutoLanguage'

// `page` marks which standalone page renders the header; section links then
// point back to the landing instead of to anchors that don't exist here.
export default function Header({
  page,
  alternates,
}: {
  page?: Page
  alternates?: Record<Language, string>
}) {
  const { t, i18n } = useTranslation()
  const [scrolled, setScrolled] = useState(false)
  const [heroCtaPassed, setHeroCtaPassed] = useState(false)
  const [open, setOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const languageRef = useRef<HTMLDivElement>(null)
  const [offered, dismissOffer] = useAutoLanguage()
  const lang = i18n.language as Language
  const home = HOME[lang]
  const languageHref = (code: Language) =>
    alternates?.[code] ?? (page ? PAGES[page][code] : HOME[code])
  // A manual choice persists, and landing-page section ids survive the switch.
  const switchLanguage = (code: Language) => (e: React.MouseEvent) => {
    rememberLanguage(code)
    if (typeof window !== 'undefined' && window.location.hash) {
      e.preventDefault()
      window.location.href = languageHref(code) + window.location.hash
    }
  }
  const sectionHref = (id: string) => (page ? `${home}#${id}` : `#${id}`)
  const featuresHref = PAGES.features[lang]
  const guideHref = PAGES.guide[lang]
  const useCasesHref = PAGES.useCases[lang]
  const changelogHref = PAGES.changelog[lang]

  useEffect(() => {
    const onScroll = () => setScrolled((current) => isCondensed(window.scrollY, current))
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const heroCta = document.getElementById('hero-download')
    if (!heroCta) return
    const io = new IntersectionObserver(([entry]) =>
      setHeroCtaPassed(
        showsHeaderDownload({
          isIntersecting: entry.isIntersecting,
          top: entry.boundingClientRect.top,
        }),
      ),
    )
    io.observe(heroCta)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!languageOpen) return
    const onPointer = (e: PointerEvent) => {
      if (!languageRef.current?.contains(e.target as Node)) setLanguageOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLanguageOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [languageOpen])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    // Lock the page behind the open menu so scrolling acts on the menu, not the
    // content under it; the panel scrolls internally when it's taller than the viewport.
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-300 ${
        scrolled
          ? 'border-b border-line/70 bg-bg/80 backdrop-blur-md'
          : 'border-b border-transparent'
      }`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-full focus:bg-blue focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-bg"
      >
        {t('nav.skipToContent')}
      </a>
      {offered && (
        <div
          data-testid="language-offer"
          lang={offered}
          className="border-b border-line/70 bg-bg/95 text-sm text-muted"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-6 py-2">
            <span>{t('nav.languageOffer.text', { lng: offered })}</span>
            <a
              data-testid="language-offer-switch"
              href={languageHref(offered)}
              onClick={switchLanguage(offered)}
              className="font-semibold text-blue transition-colors hover:text-cyan"
            >
              {t('nav.languageOffer.switch', { lng: offered })}
            </a>
            <button
              type="button"
              data-testid="language-offer-dismiss"
              onClick={dismissOffer}
              className="text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
            >
              {t('nav.languageOffer.dismiss', { lng: offered })}
            </button>
          </div>
        </div>
      )}
      {/* Fixed height, always. The header used to animate its own padding, which
          shortened the document as it condensed — near the threshold that fed back
          into the scroll position and flickered between both sizes. The row doesn't
          scale either: shrinking it about its centre pulled the logo off the page's
          left edge. Only the background changes on scroll. */}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href={page ? home : '#top'} className="flex items-center gap-2">
          {/* The disc cropped to its rim, not the app icon: the icon keeps the margin macOS
              asks of a Dock tile, which held the disc to 36 of these 48px, and its dark rim
              melted into the page so only the blue label read. Here the rim is lifted. */}
          <img
            src="/logo.svg"
            alt="Surco"
            width={48}
            height={48}
            className="h-10 w-10 sm:h-12 sm:w-12"
          />
          <span className="text-xl font-semibold leading-none tracking-tight">Surco</span>
        </a>
        <div className="flex items-center gap-4 sm:gap-7">
          <nav className="hidden items-center gap-7 text-sm text-muted lg:flex">
            {HEADER_SECTIONS.map((id) => (
              <a key={id} href={sectionHref(id)} className="transition-colors hover:text-fg">
                {t(`nav.${id}`)}
              </a>
            ))}
            <a href={featuresHref} className="transition-colors hover:text-fg">
              {t('nav.funciones')}
            </a>
            <a href={guideHref} className="transition-colors hover:text-fg">
              {t('nav.guia')}
            </a>
            <a
              href={useCasesHref}
              data-testid="header-use-cases"
              className="transition-colors hover:text-fg"
            >
              {t('nav.casos')}
            </a>
            <a href={changelogHref} className="transition-colors hover:text-fg">
              {t('nav.cambios')}
            </a>
            {/* A link like its neighbours: as a filled pill it was a second primary action
                above the fold, as loud as the download it sat across from. */}
            <a
              href={DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackDonate('header')}
              className="transition-colors hover:text-fg"
            >
              {t('nav.donar')}
            </a>
          </nav>
          {/* The menu stays mounted while closed so its links ship in the prerendered
              HTML: crawlers and readers without scripts still reach every language. */}
          <div ref={languageRef} className="relative">
            <button
              type="button"
              data-testid="language-menu-toggle"
              aria-expanded={languageOpen}
              aria-controls="language-menu"
              onClick={() => setLanguageOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 py-2 text-sm text-muted transition-colors hover:text-fg"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9s1.2-6.4 3.8-9z" />
              </svg>
              <span className="sr-only">{t('nav.language')} </span>
              <span lang={lang}>{LANGUAGE_NAMES[lang]}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`transition-transform duration-200 ${languageOpen ? 'rotate-180' : ''}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <ul
              id="language-menu"
              className={`absolute top-full right-0 z-50 mt-2 w-44 rounded-xl border border-line bg-surface2 p-1.5 shadow-[0_16px_40px_rgba(12,14,20,0.6)] transition-[opacity,translate,visibility] duration-150 ease-out ${
                languageOpen ? 'opacity-100' : 'invisible -translate-y-1 opacity-0'
              }`}
            >
              {LANGUAGES.map((code) => (
                <li key={code}>
                  <a
                    href={languageHref(code)}
                    hrefLang={code}
                    lang={code}
                    data-testid={`language-menu-${code}`}
                    aria-current={code === lang ? 'true' : undefined}
                    onClick={switchLanguage(code)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-surface hover:text-fg ${
                      code === lang ? 'bg-surface text-fg' : 'text-muted'
                    }`}
                  >
                    {LANGUAGE_NAMES[code]}
                    {code === lang && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="text-blue"
                      >
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <a
            href="#instalar"
            data-testid="header-download"
            className={`hidden ${btnPrimary} px-4 py-1.5 text-sm sm:inline-flex ${
              heroCtaPassed ? '' : 'pointer-events-none invisible translate-y-1 opacity-0'
            }`}
          >
            {t('nav.download')}
          </a>
          <button
            type="button"
            aria-label={open ? t('nav.closeMenu') : t('nav.openMenu')}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-blue/50 hover:text-fg lg:hidden"
          >
            {open ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Stays mounted so open and close both transition (a conditional render
          unmounts before the exit can play): the panel slides down from the bar
          and back up into it, links fade with it. `invisible` keeps the closed
          panel out of the tab order and away from clicks. */}
      <nav
        id="mobile-nav"
        aria-hidden={!open}
        className={`absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-t bg-bg/95 backdrop-blur-md transition-[opacity,translate,visibility] duration-200 ease-out lg:hidden ${
          open
            ? 'border-line/70 opacity-100'
            : 'invisible -translate-y-2 border-transparent opacity-0'
        }`}
      >
        <div className="mx-auto max-w-6xl px-6 py-2">
          {HEADER_SECTIONS.map((id) => (
            <a
              key={id}
              href={sectionHref(id)}
              onClick={() => setOpen(false)}
              className="block py-3 text-sm text-muted transition-colors hover:text-fg"
            >
              {t(`nav.${id}`)}
            </a>
          ))}
          <a
            href={featuresHref}
            onClick={() => setOpen(false)}
            className="block py-3 text-sm text-muted transition-colors hover:text-fg"
          >
            {t('nav.funciones')}
          </a>
          <a
            href={guideHref}
            onClick={() => setOpen(false)}
            className="block py-3 text-sm text-muted transition-colors hover:text-fg"
          >
            {t('nav.guia')}
          </a>
          <a
            href={useCasesHref}
            data-testid="header-mobile-use-cases"
            onClick={() => setOpen(false)}
            className="block py-3 text-sm text-muted transition-colors hover:text-fg"
          >
            {t('nav.casos')}
          </a>
          <a
            href={changelogHref}
            onClick={() => setOpen(false)}
            className="block py-3 text-sm text-muted transition-colors hover:text-fg"
          >
            {t('nav.cambios')}
          </a>
          <a
            href={DONATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              trackDonate('header-mobile')
              setOpen(false)
            }}
            className="flex items-center gap-2 py-3 text-sm text-blue transition-colors hover:text-cyan"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {t('nav.donar')}
          </a>
        </div>
      </nav>
    </header>
  )
}
