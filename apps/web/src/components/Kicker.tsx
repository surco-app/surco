// Section eyebrow shared by every section opener and every step of the home's walkthrough.
// Set in the page's own face rather than mono: mono is kept for figures the reader can
// check (versions, sizes, commands), so a label set in it read as data.
export default function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.9375rem] font-medium text-blue">{children}</p>
}
