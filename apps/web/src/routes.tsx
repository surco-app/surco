import type { RouteRecord } from 'vite-react-ssg'
import { Head } from 'vite-react-ssg'
import { I18nextProvider } from 'react-i18next'
import type { i18n } from 'i18next'
import App from './App'
import { createI18n, type Language } from './i18n'

const SITE = 'https://getsurco.app'
const PATHS: Record<Language, string> = { es: '/', en: '/en' }

const I18N: Record<Language, i18n> = { es: createI18n('es'), en: createI18n('en') }

function DocumentHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + PATHS[lng]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Surco',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'macOS',
    url,
    image: `${SITE}/og.png`,
    inLanguage: t('meta.inLanguage'),
    softwareVersion: '0.1.0',
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

export const routes: RouteRecord[] = [
  { path: '/', element: <LocalizedApp lng="es" />, entry: 'src/routes.tsx' },
  { path: '/en', element: <LocalizedApp lng="en" />, entry: 'src/routes.tsx' },
]
