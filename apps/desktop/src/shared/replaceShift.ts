export type UnmovedReason = 'noMatch' | 'drift' | 'unreadable'
export type ReplaceShift = { moved: number } | { unmoved: UnmovedReason }
