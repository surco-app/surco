import { Fragment, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function AnchorLink({ id }: { id: string }) {
  const { t } = useTranslation()
  return (
    <a
      href={`#${id}`}
      data-testid="scene-anchor"
      aria-label={t('home.anchorLink')}
      className="ml-2 font-normal text-faint opacity-0 transition-[color,opacity] group-hover/title:opacity-100 hover:text-blue focus-visible:opacity-100"
    >
      #
    </a>
  )
}

export function Replayable({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [run, setRun] = useState(0)
  return (
    <div className="group relative">
      <Fragment key={run}>{children}</Fragment>
      <button
        type="button"
        data-testid="scene-replay"
        aria-label={t('home.replay')}
        title={t('home.replay')}
        onClick={() => setRun((n) => n + 1)}
        className="absolute right-3 bottom-3 z-20 grid size-8 place-items-center rounded-lg border border-line bg-bg2/85 text-muted opacity-0 backdrop-blur-sm transition-[opacity,color,border-color,scale] duration-200 group-hover:opacity-100 hover:border-blue/40 hover:text-fg focus-visible:opacity-100 active:scale-[0.94] [@media(hover:none)]:opacity-100"
      >
        <svg
          aria-hidden="true"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
    </div>
  )
}
