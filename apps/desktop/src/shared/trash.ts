// What Surco's trash keeps by default (main/surcoTrash.ts).
// A week: undoing a conversion is something you realise in the same session or the
// next day, so a month of copies of every rewritten file spends disk on a net the
// user had long stopped needing. The field takes anything from 1 to 365 days.
export const TRASH_RETENTION_DAYS = 7
// Two gigabytes: about thirty AIFFs of six minutes, a week of the conversions that
// re-encode. A DJ replacing a whole crate would otherwise fill the system disk with
// copies of files he can see are fine. The field takes anything from 0.1 to 1024 GB.
export const TRASH_MAX_BYTES = 2 * 1024 * 1024 * 1024
// What the copies always leave free on the disk they live on, whatever the cap says:
// the cap is the user's number and knows nothing of the disk, and a full system disk
// breaks far more than Surco. The copies are the net, so they give way first.
export const TRASH_MIN_FREE_BYTES = 5 * 1024 * 1024 * 1024
