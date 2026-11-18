import type { CueProgram } from '../../../shared/djProgram'

type Echoed = (program: CueProgram, paths: string[]) => void

const expected = new Set<string>()
const listeners = new Set<Echoed>()

const keyOf = (program: CueProgram, path: string): string => `${program}\n${path}`

export function expectCueSave(program: CueProgram, paths: string[]): void {
  for (const path of paths) expected.add(keyOf(program, path))
}

export function forgetCueSave(program: CueProgram, paths: string[]): void {
  for (const path of paths) expected.delete(keyOf(program, path))
}

export function onCueSaveEchoed(listener: Echoed): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function claimCueSave(
  program: CueProgram,
  applied: { tracks: number; changes: number; cues?: string[] },
): boolean {
  const paths = applied.cues ?? []
  const whole = paths.length > 0 && applied.tracks === paths.length && applied.changes === 0
  if (!whole || !paths.every((path) => expected.has(keyOf(program, path)))) return false
  forgetCueSave(program, paths)
  for (const listener of listeners) listener(program, paths)
  return true
}
