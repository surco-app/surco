const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function waitForExit(
  isRunning: () => Promise<boolean>,
  options: { attempts?: number; waitMs?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const { attempts = 30, waitMs = 500, wait = sleep } = options
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!(await isRunning())) return true
    await wait(waitMs)
  }
  return false
}
