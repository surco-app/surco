import changelogEn from '../../../../../web/src/i18n/changelog/en.json'
import changelogEs from '../../../../../web/src/i18n/changelog/es.json'
import changelogJa from '../../../../../web/src/i18n/changelog/ja.json'
import type { ChangelogRelease } from './whatsNew'

// The desktop reads the web's changelog files directly (same monorepo) so the
// what's-new popup and the /cambios page can never drift apart: curating a release
// there is the single step that feeds both. The changelog is curated in Spanish, English
// and Japanese, so every other UI locale reads the English one.
export function changelogReleases(locale: string): ChangelogRelease[] {
  if (locale === 'es') return changelogEs as ChangelogRelease[]
  if (locale === 'ja') return changelogJa as ChangelogRelease[]
  return changelogEn as ChangelogRelease[]
}
