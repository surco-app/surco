// vendor/baken/UPSTREAM holds url, tag and commit, one per line. Split on CRLF too: a
// Windows checkout that converted the file would leave a '\r' on the tag, and
// `git clone --branch` would then fail on that runner only.
export const parseUpstream = (text) => text.trim().split(/\r?\n/)
