import { Analytics } from '@vercel/analytics/react'
import type { i18n } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { Outlet } from 'react-router-dom'
import type { RouteRecord } from 'vite-react-ssg'
import { Head } from 'vite-react-ssg'
import App from './App'
import Changelog from './components/Changelog'
import DonateCancel from './components/DonateCancel'
import DonateCompleted from './components/DonateCompleted'
import Features from './components/Features'
import FlacToAiff from './components/FlacToAiff'
import GoogleAnalytics from './components/GoogleAnalytics'
import Guide from './components/Guide'
import Privacy from './components/Privacy'
import UseCasePage, { type UseCase } from './components/UseCase'
import UseCases from './components/UseCases'
import { createI18n, type Language } from './i18n'
import { HOME, PAGES } from './lib/nav'
import { SITE } from './lib/sitemap'
import { type RecipePage, recipePages } from './lib/useCases'

const PATHS = HOME
const FEATURE_PATHS = PAGES.features
const GUIDE_PATHS = PAGES.guide
const USE_CASES_PATHS = PAGES.useCases
const CHANGELOG_PATHS = PAGES.changelog
const FLAC_TO_AIFF_PATHS = PAGES.flacToAiff
const PRIVACY_PATHS = PAGES.privacy

const I18N: Record<Language, i18n> = {
  es: createI18n('es'),
  en: createI18n('en'),
  ja: createI18n('ja'),
}

function DocumentHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + PATHS[lng]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Surco',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'macOS, Windows, Linux',
    url,
    image: `${SITE}/og.png`,
    screenshot: `${SITE}/hero-app.webp`,
    inLanguage: t('meta.inLanguage'),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: t('meta.jsonLdDescription'),
  }
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('meta.title')}</title>
      <meta name="description" content={t('meta.description')} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}/`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}/en`} />
      <link rel="alternate" hrefLang="ja" href={`${SITE}/ja`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}/`} />
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('meta.ogTitle')} />
      <meta property="og:description" content={t('meta.ogDescription')} />
      <meta name="twitter:title" content={t('meta.ogTitle')} />
      <meta name="twitter:description" content={t('meta.ogDescription')} />
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
    </Head>
  )
}

function LocalizedApp({ lng }: { lng: Language }) {
  return (
    <I18nextProvider i18n={I18N[lng]}>
      <DocumentHead lng={lng} />
      <App />
    </I18nextProvider>
  )
}

function FeaturesHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + FEATURE_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('features.metaTitle')}</title>
      <meta name="description" content={t('features.metaDescription')} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}${FEATURE_PATHS.es}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}${FEATURE_PATHS.en}`} />
      <link rel="alternate" hrefLang="ja" href={`${SITE}${FEATURE_PATHS.ja}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${FEATURE_PATHS.es}`} />
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('features.metaTitle')} />
      <meta property="og:description" content={t('features.metaDescription')} />
      <meta name="twitter:title" content={t('features.metaTitle')} />
      <meta name="twitter:description" content={t('features.metaDescription')} />
    </Head>
  )
}

function LocalizedFeatures({ lng }: { lng: Language }) {
  return (
    <I18nextProvider i18n={I18N[lng]}>
      <FeaturesHead lng={lng} />
      <Features />
    </I18nextProvider>
  )
}

function GuideHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + GUIDE_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('guide.metaTitle')}</title>
      <meta name="description" content={t('guide.metaDescription')} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}${GUIDE_PATHS.es}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}${GUIDE_PATHS.en}`} />
      <link rel="alternate" hrefLang="ja" href={`${SITE}${GUIDE_PATHS.ja}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${GUIDE_PATHS.es}`} />
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('guide.metaTitle')} />
      <meta property="og:description" content={t('guide.metaDescription')} />
      <meta name="twitter:title" content={t('guide.metaTitle')} />
      <meta name="twitter:description" content={t('guide.metaDescription')} />
    </Head>
  )
}

function LocalizedGuide({ lng }: { lng: Language }) {
  return (
    <I18nextProvider i18n={I18N[lng]}>
      <GuideHead lng={lng} />
      <Guide />
    </I18nextProvider>
  )
}

function UseCasesHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + USE_CASES_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('useCases.metaTitle')}</title>
      <meta name="description" content={t('useCases.metaDescription')} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}${USE_CASES_PATHS.es}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}${USE_CASES_PATHS.en}`} />
      <link rel="alternate" hrefLang="ja" href={`${SITE}${USE_CASES_PATHS.ja}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${USE_CASES_PATHS.es}`} />
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('useCases.metaTitle')} />
      <meta property="og:description" content={t('useCases.metaDescription')} />
      <meta name="twitter:title" content={t('useCases.metaTitle')} />
      <meta name="twitter:description" content={t('useCases.metaDescription')} />
    </Head>
  )
}

function LocalizedUseCases({ lng }: { lng: Language }) {
  return (
    <I18nextProvider i18n={I18N[lng]}>
      <UseCasesHead lng={lng} />
      <UseCases />
    </I18nextProvider>
  )
}

function RecipeHead({ page }: { page: RecipePage }) {
  const t = I18N[page.lang].getFixedT(page.lang)
  const cases = t('useCases.cases', { returnObjects: true }) as UseCase[]
  const c = cases.find((o) => o.id === page.id) as UseCase
  const url = SITE + page.path
  const title = t('useCases.recipeMetaTitle', { title: c.title })
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{title}</title>
      <meta name="description" content={c.body[0]} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}${page.alternates.es}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}${page.alternates.en}`} />
      <link rel="alternate" hrefLang="ja" href={`${SITE}${page.alternates.ja}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${page.alternates.es}`} />
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={c.body[0]} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={c.body[0]} />
    </Head>
  )
}

function LocalizedRecipe({ page }: { page: RecipePage }) {
  return (
    <I18nextProvider i18n={I18N[page.lang]}>
      <RecipeHead page={page} />
      <UseCasePage id={page.id} />
    </I18nextProvider>
  )
}

function ChangelogHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + CHANGELOG_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('changelog.metaTitle')}</title>
      <meta name="description" content={t('changelog.metaDescription')} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}${CHANGELOG_PATHS.es}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}${CHANGELOG_PATHS.en}`} />
      <link rel="alternate" hrefLang="ja" href={`${SITE}${CHANGELOG_PATHS.ja}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${CHANGELOG_PATHS.es}`} />
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('changelog.metaTitle')} />
      <meta property="og:description" content={t('changelog.metaDescription')} />
      <meta name="twitter:title" content={t('changelog.metaTitle')} />
      <meta name="twitter:description" content={t('changelog.metaDescription')} />
    </Head>
  )
}

function LocalizedChangelog({ lng }: { lng: Language }) {
  return (
    <I18nextProvider i18n={I18N[lng]}>
      <ChangelogHead lng={lng} />
      <Changelog />
    </I18nextProvider>
  )
}

function FlacToAiffHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + FLAC_TO_AIFF_PATHS[lng]
  const faq = t('flacToAiff.faq.items', { returnObjects: true }) as { q: string; a: string }[]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: t('meta.inLanguage'),
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('flacToAiff.metaTitle')}</title>
      <meta name="description" content={t('flacToAiff.metaDescription')} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}${FLAC_TO_AIFF_PATHS.es}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}${FLAC_TO_AIFF_PATHS.en}`} />
      <link rel="alternate" hrefLang="ja" href={`${SITE}${FLAC_TO_AIFF_PATHS.ja}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${FLAC_TO_AIFF_PATHS.es}`} />
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('flacToAiff.metaTitle')} />
      <meta property="og:description" content={t('flacToAiff.metaDescription')} />
      <meta name="twitter:title" content={t('flacToAiff.metaTitle')} />
      <meta name="twitter:description" content={t('flacToAiff.metaDescription')} />
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
    </Head>
  )
}

function LocalizedFlacToAiff({ lng }: { lng: Language }) {
  return (
    <I18nextProvider i18n={I18N[lng]}>
      <FlacToAiffHead lng={lng} />
      <FlacToAiff />
    </I18nextProvider>
  )
}

function PrivacyHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + PRIVACY_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('privacy.metaTitle')}</title>
      <meta name="description" content={t('privacy.metaDescription')} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}${PRIVACY_PATHS.es}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}${PRIVACY_PATHS.en}`} />
      <link rel="alternate" hrefLang="ja" href={`${SITE}${PRIVACY_PATHS.ja}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${PRIVACY_PATHS.es}`} />
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('privacy.metaTitle')} />
      <meta property="og:description" content={t('privacy.metaDescription')} />
      <meta name="twitter:title" content={t('privacy.metaTitle')} />
      <meta name="twitter:description" content={t('privacy.metaDescription')} />
    </Head>
  )
}

function LocalizedPrivacy({ lng }: { lng: Language }) {
  return (
    <I18nextProvider i18n={I18N[lng]}>
      <PrivacyHead lng={lng} />
      <Privacy />
    </I18nextProvider>
  )
}

function NoIndex({ children }: { children: ReactNode }) {
  return (
    <>
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      {children}
    </>
  )
}

// Wraps every page so the analytics components load once across all routes (they
// render nothing during SSG and inject their client scripts after hydration).
function RootLayout() {
  return (
    <>
      <Outlet />
      <Analytics />
      <GoogleAnalytics />
    </>
  )
}

export const routes: RouteRecord[] = [
  {
    path: '/',
    element: <RootLayout />,
    entry: 'src/routes.tsx',
    children: [
      { index: true, element: <LocalizedApp lng="es" />, entry: 'src/routes.tsx' },
      { path: 'en', element: <LocalizedApp lng="en" />, entry: 'src/routes.tsx' },
      { path: 'ja', element: <LocalizedApp lng="ja" />, entry: 'src/routes.tsx' },
      { path: 'funciones', element: <LocalizedFeatures lng="es" />, entry: 'src/routes.tsx' },
      { path: 'en/features', element: <LocalizedFeatures lng="en" />, entry: 'src/routes.tsx' },
      { path: 'ja/features', element: <LocalizedFeatures lng="ja" />, entry: 'src/routes.tsx' },
      { path: 'guia', element: <LocalizedGuide lng="es" />, entry: 'src/routes.tsx' },
      { path: 'en/guide', element: <LocalizedGuide lng="en" />, entry: 'src/routes.tsx' },
      { path: 'ja/guide', element: <LocalizedGuide lng="ja" />, entry: 'src/routes.tsx' },
      { path: 'casos-de-uso', element: <LocalizedUseCases lng="es" />, entry: 'src/routes.tsx' },
      { path: 'en/use-cases', element: <LocalizedUseCases lng="en" />, entry: 'src/routes.tsx' },
      { path: 'ja/use-cases', element: <LocalizedUseCases lng="ja" />, entry: 'src/routes.tsx' },
      ...recipePages().map((page) => ({
        path: page.path.slice(1),
        element: <LocalizedRecipe page={page} />,
        entry: 'src/routes.tsx',
      })),
      { path: 'cambios', element: <LocalizedChangelog lng="es" />, entry: 'src/routes.tsx' },
      { path: 'en/changelog', element: <LocalizedChangelog lng="en" />, entry: 'src/routes.tsx' },
      { path: 'ja/changelog', element: <LocalizedChangelog lng="ja" />, entry: 'src/routes.tsx' },
      {
        path: 'convertir/flac-a-aiff',
        element: <LocalizedFlacToAiff lng="es" />,
        entry: 'src/routes.tsx',
      },
      {
        path: 'en/convert/flac-to-aiff',
        element: <LocalizedFlacToAiff lng="en" />,
        entry: 'src/routes.tsx',
      },
      {
        path: 'ja/convert/flac-to-aiff',
        element: <LocalizedFlacToAiff lng="ja" />,
        entry: 'src/routes.tsx',
      },
      {
        path: 'privacidad',
        element: <LocalizedPrivacy lng="es" />,
        entry: 'src/routes.tsx',
      },
      {
        path: 'en/privacy',
        element: <LocalizedPrivacy lng="en" />,
        entry: 'src/routes.tsx',
      },
      {
        path: 'ja/privacy',
        element: <LocalizedPrivacy lng="ja" />,
        entry: 'src/routes.tsx',
      },
      // Transactional pages PayPal redirects to after the donate flow: their copy is
      // self-contained and language-detected on the client, so they don't need the
      // localized App shell.
      {
        path: 'donate/cancel',
        element: (
          <NoIndex>
            <DonateCancel />
          </NoIndex>
        ),
        entry: 'src/routes.tsx',
      },
      {
        path: 'donate/completed',
        element: (
          <NoIndex>
            <DonateCompleted />
          </NoIndex>
        ),
        entry: 'src/routes.tsx',
      },
    ],
  },
]
