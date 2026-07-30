import type { ReactNode } from 'react'

// Window chrome around every scene's screenshot-in-HTML. Drawing it here rather
// than shipping a real screenshot per scene keeps the type crisp at any width and
// lets each scene light up only the parts it's talking about.
//
// `progress` is the toolbar's bottom border doing double duty as the app's global
// progress hairline, which is how the real app pools its four concurrent sweeps.
export default function AppFrame({
  children,
  pill,
  busy = false,
  progress,
}: {
  children: ReactNode
  pill?: string
  busy?: boolean
  progress?: number
}) {
  return (
    <div className="inset-shadow-edge overflow-hidden rounded-xl border border-line bg-surface2/60 shadow-2xl shadow-black/40">
      <div className="relative flex h-9 items-center gap-2 border-b border-line bg-surface/60 px-3">
        <span aria-hidden="true" className="flex gap-1.5">
          <i className="block size-2 rounded-full bg-line" />
          <i className="block size-2 rounded-full bg-line" />
          <i className="block size-2 rounded-full bg-line" />
        </span>
        {pill && (
          <span
            className={`ml-auto flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${
              busy ? 'border-blue/45 text-blue' : 'border-line text-muted'
            }`}
          >
            {busy && (
              <i
                aria-hidden="true"
                className="block size-2 rounded-full border border-blue border-t-transparent"
                style={{ animation: 'spin 0.8s linear infinite' }}
              />
            )}
            {pill}
          </span>
        )}
        {progress !== undefined && (
          <span
            aria-hidden="true"
            className="absolute -bottom-px left-0 h-0.5 bg-blue"
            style={{ width: `${progress}%` }}
          />
        )}
      </div>
      {children}
    </div>
  )
}
