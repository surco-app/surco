import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { constants as osConstants, setPriority } from 'node:os'
import { forcedInputArgs } from '../shared/inputFormat'
import { type ChannelWave, createChannelScan, type MonoWave } from './waveform'

// The scans decoding right now, keyed by the file each one is reading. This spawn happens
// inside the DSP worker thread, so the main process's activeConversions registry never sees
// it and app.on('will-quit') has nothing to kill: quitting mid-scan left the most expensive
// probe in the app — a native stereo decode of a long mix — running on with only its
// two-minute timeout as a backstop. Entries are removed as each child settles so a quit can
// never signal a pid the OS has already handed to someone else.
// Keyed by path (rather than a bare set) so the renderer's audio:cancelAnalysis can stop the
// one decode a browsed-past track is holding, instead of only the whole lot at shutdown.
const active = new Map<string, Set<ChildProcess>>()

function forget(input: string, child: ChildProcess): void {
  const set = active.get(input)
  if (!set) return
  set.delete(child)
  if (set.size === 0) active.delete(input)
}

// Stop every scan still decoding. Called when the worker is shutting down; safe to call
// when nothing is running.
export function killActiveScans(): void {
  for (const set of active.values()) for (const child of set) child.kill('SIGTERM')
  active.clear()
}

// Stop the scans reading one file — the shared decode's last consumer went away. Safe to
// call for a path with nothing running.
export function killScansFor(input: string): void {
  for (const child of active.get(input) ?? []) child.kill('SIGTERM')
  active.delete(input)
}

// How many scans are registered. A sweep runs this probe over every track in a crate, so
// the registry emptying itself as children settle is what keeps it from growing all
// session — exposed so a test can hold that line.
export function activeScanCount(): number {
  let total = 0
  for (const set of active.values()) total += set.size
  return total
}

// Everything the one native decode yields: the clip flags and split lanes the compare
// strip draws, plus the mono envelope and frame count the waveform probe used to pay a
// second full decode for.
export interface FullScan {
  clipped: boolean[]
  channels: ChannelWave[]
  mono: MonoWave
  frames: number
}

// The spawn+stream half of the native channel scan, extracted worker-safe: it takes
// ffmpegPath and the channel count as data (the worker thread has no `app`/binaries to
// resolve them itself) so it can run inside the analysis worker, off the main process's
// event loop. Streamed via spawn because a native stereo decode of a long mix is gigabytes
// of f32, far past any exec buffer, while the scan itself keeps only per-block accumulators.
export function runChannelScan(
  input: string,
  ffmpegPath: string,
  channels: number,
  timeoutMs: number,
): Promise<FullScan> {
  const scan = createChannelScan(Math.max(1, channels))
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...forcedInputArgs(input),
        '-i',
        input,
        '-map',
        '0:a:0',
        '-f',
        'f32le',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs },
    )
    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        // Same best-effort niceness as niceDecode: normal priority is a fine fallback.
      }
    }
    // stdout chunks split at arbitrary byte offsets, so carry each chunk's tail bytes
    // into the next before viewing as f32 — and copy out of Node's shared Buffer pool,
    // whose offsets need not be 4-byte aligned (same dance as decodePcm).
    let tail = Buffer.alloc(0)
    child.stdout.on('data', (chunk: Buffer) => {
      const data = tail.length > 0 ? Buffer.concat([tail, chunk]) : chunk
      const usable = data.length - (data.length % 4)
      tail = Buffer.from(data.subarray(usable))
      if (usable === 0) return
      const aligned = new Uint8Array(usable)
      aligned.set(data.subarray(0, usable))
      scan.push(new Float32Array(aligned.buffer))
    })
    const set = active.get(input)
    if (set) set.add(child)
    else active.set(input, new Set([child]))
    child.on('error', (err) => {
      forget(input, child)
      reject(err)
    })
    child.on('close', (code) => {
      forget(input, child)
      if (code === 0) resolve(scan.finish())
      else reject(new Error(`channel scan exited with code ${code}`))
    })
  })
}
