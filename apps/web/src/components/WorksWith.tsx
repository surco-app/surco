import { useTranslation } from 'react-i18next'

const SOURCES = ['Discogs', 'Bandcamp', 'Deezer', 'Beatport', 'MusicBrainz']
const PROGRAMS = ['rekordbox', 'Traktor', 'Engine DJ', 'Serato', 'VirtualDJ', 'Apple Music']

function Group({ testId, label, names }: { testId: string; label: string; names: string[] }) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 sm:contents"
    >
      <p className="shrink-0 text-sm text-faint">{label}</p>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  )
}

export default function WorksWith() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 border-y border-line py-5 sm:grid-cols-[auto_1fr] sm:items-baseline sm:gap-x-8 sm:gap-y-3">
      <Group testId="works-with-sources" label={t('home.worksWithSources')} names={SOURCES} />
      <Group testId="works-with-programs" label={t('home.worksWithPrograms')} names={PROGRAMS} />
    </div>
  )
}
