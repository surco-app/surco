// What Surco's trash keeps (main/surcoTrash.ts), shared so the panel can say it too.
// A week: undoing a conversion is something you realise in the same session or the
// next day, so a month of copies of every rewritten file spends disk on a net the
// user had long stopped needing. The field takes anything from 1 to 365 days.
export const TRASH_RETENTION_DAYS = 7
// Ten gigabytes: a hundred and fifty AIFFs of six minutes. A DJ replacing a whole
// crate would otherwise fill the system disk with copies of files he can see are fine.
export const TRASH_MAX_BYTES = 10 * 1024 * 1024 * 1024
