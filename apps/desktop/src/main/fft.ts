// In-place iterative radix-2 FFT (Cooley-Tukey). The input length must be a
// power of two. Shared by the DSP analyzers (musical key, HF-shelf detection)
// so the same hand-tuned transform backs every spectral pass instead of each
// shipping its own copy.
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let j = 0; j < len / 2; j++) {
        const aRe = re[i + j]
        const aIm = im[i + j]
        const bRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm
        const bIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe
        re[i + j] = aRe + bRe
        im[i + j] = aIm + bIm
        re[i + j + len / 2] = aRe - bRe
        im[i + j + len / 2] = aIm - bIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}
