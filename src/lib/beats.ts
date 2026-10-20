/**
 * Beat detection: spectral-flux onset envelope, tempo from autocorrelation,
 * then a fixed-tempo beat grid whose phase best matches the onsets, with each
 * beat nudged onto the nearest strong onset.
 */

const FFT_SIZE = 1024
const HOP = 512

function fftMagnitudes(re: Float32Array, im: Float32Array) {
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
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
  const mags = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) mags[i] = Math.log1p(Math.hypot(re[i], im[i]))
  return mags
}

export function onsetEnvelope(samples: Float32Array): Float32Array {
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP))
  const env = new Float32Array(frames)
  const window = new Float32Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE))
  let prev = new Float32Array(FFT_SIZE / 2)
  for (let f = 0; f < frames; f++) {
    const re = new Float32Array(FFT_SIZE)
    const im = new Float32Array(FFT_SIZE)
    const off = f * HOP
    for (let i = 0; i < FFT_SIZE; i++) re[i] = samples[off + i] * window[i]
    const mags = fftMagnitudes(re, im)
    let flux = 0
    for (let i = 0; i < mags.length; i++) flux += Math.max(0, mags[i] - prev[i])
    env[f] = flux
    prev = mags
  }
  // Subtract a moving average so slow loudness changes don't read as onsets.
  const out = new Float32Array(frames)
  const w = 8
  for (let i = 0; i < frames; i++) {
    let s = 0
    let c = 0
    for (let j = Math.max(0, i - w); j <= Math.min(frames - 1, i + w); j++) (s += env[j]), c++
    out[i] = Math.max(0, env[i] - s / c)
  }
  return out
}

export function detectBeats(samples: Float32Array, sampleRate: number) {
  const env = onsetEnvelope(samples)
  const fps = sampleRate / HOP
  if (env.length < fps * 2) return { bpm: 0, beats: [] as number[] }

  // Tempo: autocorrelation peak between 70 and 180 BPM, lightly biased toward ~120.
  const minLag = Math.floor((60 / 180) * fps)
  const maxLag = Math.ceil((60 / 70) * fps)
  let bestLag = minLag
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag]
    const bpm = (60 * fps) / lag
    s *= Math.exp(-0.5 * Math.log2(bpm / 120) ** 2)
    if (s > bestScore) (bestScore = s), (bestLag = lag)
  }
  // Parabolic interpolation for a sub-frame period.
  const ac = (lag: number) => {
    let s = 0
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag]
    return s
  }
  const y0 = ac(bestLag - 1)
  const y1 = ac(bestLag)
  const y2 = ac(bestLag + 1)
  const denom = y0 - 2 * y1 + y2
  const period = bestLag + (denom ? (0.5 * (y0 - y2)) / denom : 0)

  // Beat tracking by dynamic programming (Ellis 2007): each beat rewards onset
  // strength and penalises spacing that strays from the tempo period, so the
  // grid follows small tempo drift instead of sliding off the onsets.
  const n = env.length
  let sd = 0
  for (let i = 0; i < n; i++) sd += env[i] * env[i]
  sd = Math.sqrt(sd / n) || 1
  const local = env.map((v) => v / sd)
  const alpha = 100
  const score = new Float32Array(n)
  const back = new Int32Array(n).fill(-1)
  for (let t = 0; t < n; t++) {
    let best = 0
    let arg = -1
    for (let prev = Math.max(0, Math.round(t - 2 * period)); prev <= t - Math.round(period / 2); prev++) {
      const s = score[prev] - alpha * Math.log((t - prev) / period) ** 2
      if (s > best) (best = s), (arg = prev)
    }
    score[t] = local[t] + best
    back[t] = arg
  }
  // Start the backtrace from the strongest score in the last period.
  let t = n - 1
  for (let i = Math.max(0, Math.floor(n - period)); i < n; i++) if (score[i] > score[t]) t = i
  const frames: number[] = []
  for (; t >= 0; t = back[t]) frames.push(t)
  frames.reverse()
  const beats = frames.map((f) => (f * HOP + FFT_SIZE / 2) / sampleRate)
  return { bpm: Math.round(((60 * fps) / period) * 10) / 10, beats }
}

export function mixToMono(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) out[i] += data[i] / buffer.numberOfChannels
  }
  return out
}
