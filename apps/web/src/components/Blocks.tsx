export function BlockHeading({ title, lede }: { title: string; lede?: string }) {
  return (
    <>
      <h2 className="mt-14 border-t border-line pt-8 text-2xl font-semibold tracking-tight text-balance text-fg sm:text-3xl">
        {title}
      </h2>
      {lede && (
        <p className="mt-3 max-w-2xl text-lg leading-snug text-pretty text-subtle">{lede}</p>
      )}
    </>
  )
}

export function StepList({
  steps,
  testid,
  itemTestid,
}: {
  steps: { lead: string; text: string }[]
  testid?: string
  itemTestid?: string
}) {
  return (
    <ol data-testid={testid} className="mt-6 space-y-3">
      {steps.map((step, n) => (
        <li
          key={step.lead}
          data-testid={itemTestid}
          className="flex gap-3.5 leading-relaxed text-muted"
        >
          <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full border border-line font-mono text-xs text-blue">
            {n + 1}
          </span>
          <span>
            <strong className="font-semibold text-fg">{step.lead}</strong> {step.text}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function NotesFold({
  label,
  points,
  testid,
}: {
  label: string
  points: string[]
  testid: string
}) {
  if (points.length === 0) return null
  return (
    <details data-testid={testid} className="mt-6 rounded-xl border border-line bg-surface2/40">
      <summary className="cursor-pointer px-4 py-3 text-sm text-subtle">{label}</summary>
      <ul className="space-y-2.5 px-4 pb-4">
        {points.map((point) => (
          <li key={point} className="flex gap-3 text-sm leading-relaxed text-muted">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
