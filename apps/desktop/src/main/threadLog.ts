import { isMainThread, parentPort } from 'node:worker_threads'

export interface ThreadLog {
  info: (text: string) => void
  warn: (text: string) => void
}

export interface ThreadLogMessage {
  log: [level: keyof ThreadLog, text: string]
}

const toMainProcess: ThreadLog = {
  info: (text) => parentPort?.postMessage({ log: ['info', text] } satisfies ThreadLogMessage),
  warn: (text) => parentPort?.postMessage({ log: ['warn', text] } satisfies ThreadLogMessage),
}

let sink: ThreadLog | null = isMainThread ? null : toMainProcess

export function sendLogsTo(log: ThreadLog): void {
  sink = log
}

export const threadLog: ThreadLog = {
  info: (text) => sink?.info(text),
  warn: (text) => sink?.warn(text),
}
