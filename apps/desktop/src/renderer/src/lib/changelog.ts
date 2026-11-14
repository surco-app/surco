import type { Locale } from '../i18n/locale'
import type { ChangelogRelease } from './whatsNew'

// The desktop reads the web's changelog files directly (same monorepo) so the
// what's-new popup and the /cambios page can never drift apart: curating a release
// there is the single step that feeds both, in every UI language.
const RELEASES: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import('../../../../../web/src/i18n/changelog/en.json'),
  es: () => import('../../../../../web/src/i18n/changelog/es.json'),
  de: () => import('../../../../../web/src/i18n/changelog/de.json'),
  fr: () => import('../../../../../web/src/i18n/changelog/fr.json'),
  'pt-BR': () => import('../../../../../web/src/i18n/changelog/pt-BR.json'),
  ja: () => import('../../../../../web/src/i18n/changelog/ja.json'),
  ca: () => import('../../../../../web/src/i18n/changelog/ca.json'),
  it: () => import('../../../../../web/src/i18n/changelog/it.json'),
}

export async function changelogReleases(locale: string): Promise<ChangelogRelease[]> {
  const load = RELEASES[locale as Locale] ?? RELEASES.en
  return (await load()).default as ChangelogRelease[]
}
