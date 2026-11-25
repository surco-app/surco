export type UnmovedReason = 'noMatch' | 'drift' | 'unreadable'
export type ReplaceShift = { moved: number; master?: 'other' } | { unmoved: UnmovedReason }
