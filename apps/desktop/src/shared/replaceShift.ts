export type UnmovedReason = 'noMatch' | 'drift' | 'unreadable'
export type ReplaceShift = { moved: number; master?: 'other' } | { unmoved: UnmovedReason }

// How far a Replace searches for the shift between the old file and the new one, both in its
// window search and in its whole-master search (main/replaceShiftMeasure). A copy whose music
// starts further off than this would keep its cues off by the difference.
export const REPLACE_REACH_SECONDS = 5
