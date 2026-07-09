// cancelBatch only breaks the renderer's between-track loop: an already-running
// ffmpeg conversion has no way to hear about it and keeps writing until it
// finishes (or hangs forever on a stalled network mount). This registry gives
// cancel a process to actually reach — convertAudio registers its child's kill
// function under the job id for the run's duration, and unregisters it in a
// finally so a job that finished normally can't be cancelled after the fact.
export interface ActiveConversions {
  register: (jobId: string, kill: (signal: string) => void) => void
  unregister: (jobId: string) => void
  // Returns whether a process was actually killed, so the caller can tell a
  // real cancel from a no-op (job already done, or never started).
  cancel: (jobId: string) => boolean
}

export function createActiveConversions(): ActiveConversions {
  const kills = new Map<string, (signal: string) => void>()
  return {
    register: (jobId, kill) => kills.set(jobId, kill),
    unregister: (jobId) => kills.delete(jobId),
    cancel: (jobId) => {
      const kill = kills.get(jobId)
      if (!kill) return false
      kill('SIGTERM')
      kills.delete(jobId)
      return true
    },
  }
}
