import { describe, expect, it, vi } from 'vitest'
import { sendLogsTo, threadLog } from './threadLog'

describe('threadLog', () => {
  it('stays silent until the main process names its log, since the collection thread loads this code where the app log cannot load at all', () => {
    expect(() => threadLog.warn('nothing to write to yet')).not.toThrow()
  })

  it('writes to the log the main process names, so a failed collection read still reaches the log file', () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    sendLogsTo(log)
    threadLog.info('lookup miss')
    threadLog.warn('read failed')
    expect(log.info).toHaveBeenCalledExactlyOnceWith('lookup miss')
    expect(log.warn).toHaveBeenCalledExactlyOnceWith('read failed')
  })
})
