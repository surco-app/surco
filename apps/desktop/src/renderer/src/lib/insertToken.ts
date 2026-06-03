// Splices a {token} into the filename format at the caret (or over the current
// selection), returning the new value and where the caret should land after it.
export function insertToken(
  value: string,
  start: number,
  end: number,
  token: string,
): { value: string; caret: number } {
  const insert = `{${token}}`
  return {
    value: value.slice(0, start) + insert + value.slice(end),
    caret: start + insert.length,
  }
}
