import { useTranslation } from 'react-i18next'

const SOURCES = ['Discogs', 'Bandcamp', 'Deezer', 'Beatport', 'MusicBrainz']
const PROGRAMS = ['rekordbox', 'Traktor', 'Engine DJ', 'Serato', 'VirtualDJ', 'Apple Music']

function Group({
  testId,
  label,
  names,
  end,
}: {
  testId: string
  label: string
  names: string[]
  end?: boolean
}) {
  return (
    <div
      data-testid={testId}
      className={`flex flex-col items-center gap-3 text-center ${end ? 'lg:items-end lg:text-right' : 'lg:items-start lg:text-left'}`}
    >
      <p className="text-xs font-semibold tracking-[0.08em] text-faint uppercase">{label}</p>
      <ul
        className={`flex flex-wrap justify-center gap-2 ${end ? 'lg:justify-end' : 'lg:justify-start'}`}
      >
        {names.map((name) => (
          <li
            key={name}
            className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm whitespace-nowrap"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function WorksWith() {
  const { t } = useTranslation()
  return (
    <div className="grid items-center justify-items-center py-6 lg:grid-cols-[1fr_auto_1fr] lg:justify-items-stretch">
      <Group testId="works-with-sources" label={t('home.worksWithSources')} names={SOURCES} end />
      <div
        aria-hidden="true"
        className="flex flex-col items-center py-4 lg:flex-row lg:px-5 lg:py-0"
      >
        <span className="h-7 w-px bg-gradient-to-b from-transparent to-blue opacity-70 lg:h-px lg:w-16 lg:bg-gradient-to-r" />
        <img
          src="/logo.svg"
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 rounded-full ring-6 ring-blue/15"
        />
        <span className="h-7 w-px bg-gradient-to-b from-blue to-transparent opacity-70 lg:h-px lg:w-16 lg:bg-gradient-to-r" />
      </div>
      <Group testId="works-with-programs" label={t('home.worksWithPrograms')} names={PROGRAMS} />
    </div>
  )
}
