# engine-4-overview.bin

The `overviewWaveFormData` blob of one track, copied byte for byte (compressed, as stored)
from a real Engine DJ library (schema 3.0.2) on 31/10/2026. The library was copied first and
only the copy was read. It is the same track as the real `trackData` in
`engineBlobs.test.ts` (44.1 kHz, 14751744 samples): 1024 entries of three bands, 14407.875
samples per entry, then the peak entry.

None of the 23 tracks in that library has a loop set: every `loops` blob is the same eight
empty slots, so there is no real set loop to copy.
