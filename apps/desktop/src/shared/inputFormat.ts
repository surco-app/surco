// ffmpeg picks a demuxer by scoring the first bytes, and an MP3 can lose that contest
// over its own contents: behind a large ID3 tag (a typical cover) the probe window
// keeps only a sliver of audio, and a handful of frames whose ancillary bits happen to
// spell MPEG-PS start codes outscore the real format (upstream trac #336). A user's
// normalized conversion came out exactly like that: valid everywhere, unreadable by
// every ffmpeg-based read in Surco, flipping with each re-encode's bit pattern.
// Pinning the demuxer for .mp3 inputs removes the guesswork; every other supported
// container starts with an unambiguous magic number and keeps auto-detection.
export function forcedInputArgs(path: string): string[] {
  return /\.mp3$/i.test(path) ? ['-f', 'mp3'] : []
}
