// Section eyebrow shared by every section opener. A short blue→cyan rule leads the
// mono uppercase label so each section starts with the same small, deliberate
// brand mark instead of a bare line of text. Replaces the verbatim
// `font-mono text-xs tracking-wider text-blue uppercase` paragraph that was
// duplicated across ~10 sites.
export default function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 font-mono text-xs tracking-wider text-blue uppercase">
      <span
        aria-hidden="true"
        className="h-px w-6 rounded-full bg-gradient-to-r from-blue to-cyan"
      />
      {children}
    </p>
  )
}
