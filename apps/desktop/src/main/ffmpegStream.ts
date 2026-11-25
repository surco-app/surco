import { spawn } from 'node:child_process'
import { constants as osConstants, setPriority } from 'node:os'

// Node's shared Buffer pool hands out slices whose offset need not be 4-byte aligned, so
// the bytes are copied out before being viewed as floats; a trailing partial sample is
// dropped.
export function floatsFrom(data: Uint8Array): Float32Array {
  const bytes = data.length - (data.length % 4)
  const aligned = new Uint8Array(bytes)
  aligned.set(data.subarray(0, bytes))
  return new Float32Array(aligned.buffer)
}

// stdout chunks split at arbitrary byte offsets, so carry each chunk's tail bytes into the
// next before viewing as f32.
export function f32Chunks(onFloats: (floats: Float32Array) => void): (chunk: Buffer) => void {
  let tail = Buffer.alloc(0)
  return (chunk) => {
    const data = tail.length > 0 ? Buffer.concat([tail, chunk]) : chunk
    const usable = data.length - (data.length % 4)
    tail = Buffer.from(data.subarray(usable))
    if (usable === 0) return
    onFloats(floatsFrom(data.subarray(0, usable)))
  }
}

export function spawnBackgroundDecode(ffmpegPath: string, args: string[], timeoutMs: number) {
  const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs })
  if (child.pid !== undefined) {
    try {
      setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Same best-effort niceness as niceDecode: normal priority is a fine fallback.
    }
  }
  return child
}
