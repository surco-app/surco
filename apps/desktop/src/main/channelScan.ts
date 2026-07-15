import { spawn } from 'node:child_process'
import { constants as osConstants, setPriority } from 'node:os'
import { type ChannelWave, createChannelScan } from './waveform'

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
): Promise<{ clipped: boolean[]; channels: ChannelWave[] }> {
  const scan = createChannelScan(Math.max(1, channels))
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-i', input, '-map', '0:a:0', '-f', 'f32le', '-'],
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
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(scan.finish())
      else reject(new Error(`channel scan exited with code ${code}`))
    })
  })
}
