// Normalises the tag_name from /releases/latest into a single "v"-prefixed
// label. GitHub tags aren't uniform (some repos tag "v0.1.5", some "0.1.5"), so
// we settle on one shape and return null for an empty tag — that keeps the hero
// blank until a real release lands, mirroring the button's self-disabling fetch.
export function formatVersion(tagName: string | null | undefined): string | null {
  const trimmed = tagName?.trim()
  if (!trimmed) return null
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}
