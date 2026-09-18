// What Surco's trash keeps (main/surcoTrash.ts), shared so the panel can say it too.
export const TRASH_RETENTION_DAYS = 30
// Ten gigabytes: a hundred and fifty AIFFs of six minutes. A DJ replacing a whole
// crate would otherwise fill the system disk with copies of files he can see are fine.
export const TRASH_MAX_BYTES = 10 * 1024 * 1024 * 1024
