import changelogDe from '../../../../../web/src/i18n/changelog/de.json'
import changelogEn from '../../../../../web/src/i18n/changelog/en.json'
import changelogEs from '../../../../../web/src/i18n/changelog/es.json'
import changelogFr from '../../../../../web/src/i18n/changelog/fr.json'
import changelogJa from '../../../../../web/src/i18n/changelog/ja.json'
import changelogPtBR from '../../../../../web/src/i18n/changelog/pt-BR.json'
import type { Locale } from '../i18n/locale'
import type { ChangelogRelease } from './whatsNew'

// The desktop reads the web's changelog files directly (same monorepo) so the
// what's-new popup and the /cambios page can never drift apart: curating a release
// there is the single step that feeds both, in every UI language.
const RELEASES: Record<Locale, ChangelogRelease[]> = {
  en: changelogEn as ChangelogRelease[],
  es: changelogEs as ChangelogRelease[],
  de: changelogDe as ChangelogRelease[],
  fr: changelogFr as ChangelogRelease[],
  'pt-BR': changelogPtBR as ChangelogRelease[],
  ja: changelogJa as ChangelogRelease[],
}

export function changelogReleases(locale: string): ChangelogRelease[] {
  return RELEASES[locale as Locale] ?? RELEASES.en
}
