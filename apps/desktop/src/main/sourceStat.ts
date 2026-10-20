import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'

const MAX_IN_FLIGHT = 3

let inFlight = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
}

function release(): void {
  const next = waiting.shift()
  if (next) next()
  else inFlight--
}

export function isMissing(err: NodeJS.ErrnoException): boolean {
  return err.code === 'ENOENT' || err.code === 'ENOTDIR'
}

export async function sourceStat(path: string): Promise<Stats> {
  await acquire()
  try {
    return await stat(path)
  } finally {
    release()
  }
}
