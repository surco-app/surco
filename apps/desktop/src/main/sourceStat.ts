import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { parse } from 'node:path'

const MAX_IN_FLIGHT = 3

let inFlight = 0
const waiting: (() => void)[] = []

async function acquire(urgent: boolean): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++
    return
  }
  await new Promise<void>((resolve) => (urgent ? waiting.unshift(resolve) : waiting.push(resolve)))
}

function release(): void {
  const next = waiting.shift()
  if (next) next()
  else inFlight--
}

function volumeRoot(path: string): string {
  return /^\/Volumes\/[^/]+/.exec(path)?.[0] ?? parse(path).root
}

export async function isMissing(path: string, err: NodeJS.ErrnoException): Promise<boolean> {
  if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') return false
  return stat(volumeRoot(path)).then(
    () => true,
    () => false,
  )
}

export async function sourceStat(path: string, { urgent = false } = {}): Promise<Stats> {
  await acquire(urgent)
  try {
    return await stat(path)
  } finally {
    release()
  }
}
