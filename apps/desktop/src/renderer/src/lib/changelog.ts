import changelogEn from '../../../../../web/src/i18n/changelog/en.json'
import changelogEs from '../../../../../web/src/i18n/changelog/es.json'
import type { ChangelogRelease } from './whatsNew'

// The desktop reads the web's changelog files directly (same monorepo) so the
// what's-new popup and the /cambios page can never drift apart: curating a release
// there is the single step that feeds both.
export function changelogReleases(locale: 'en' | 'es'): ChangelogRelease[] {
  return (locale === 'es' ? changelogEs : changelogEn) as ChangelogRelease[]
}
