/**
 * Splits an event's photos into parts (arrival, ceremony, dancing…). Photos are
 * taken in order, so a part is a contiguous run in time. Neighbouring runs are
 * merged, cheapest first, until the requested count remains. The cost of a
 * merge grows with how different the two runs look (CLIP image vectors, Ward
 * style) and with the time gap between them, so long breaks and changes of
 * scene become boundaries.
 */

export interface PartInput {
  takenAt: number
  vec?: Float32Array
}

/** A sensible number of parts for n photos. */
export function autoPartCount(n: number) {
  if (n < 4) return 1
  return Math.min(8, Math.max(2, Math.round(Math.sqrt(n / 2))))
}

const dist2 = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return s
}

/** Index of the first photo of each part, for photos sorted by takenAt. */
export function segment(items: PartInput[], k: number): number[] {
  const n = items.length
  if (!n) return []
  k = Math.max(1, Math.min(k, n))
  const gaps = items.slice(1).map((it, i) => Math.max(0, it.takenAt - items[i].takenAt))
  const sorted = [...gaps].sort((a, b) => a - b)
  const typical = Math.max(1000, sorted[Math.floor(sorted.length / 2)] ?? 1000)
  const maxGap = Math.max(typical, sorted[sorted.length - 1] ?? typical)
  // 0 for an ordinary gap between shots, 1 for the longest break of the event.
  const gapScore = gaps.map((g) => Math.log1p(g / typical) / Math.log1p(maxGap / typical))
  const hasVecs = items.every((it) => it.vec)

  type Run = { start: number; n: number; mean: Float32Array | null }
  let runs: Run[] = items.map((it, i) => ({ start: i, n: 1, mean: hasVecs ? Float32Array.from(it.vec!) : null }))

  const cost = (a: Run, b: Run) => {
    const w = (a.n * b.n) / (a.n + b.n)
    const visual = a.mean && b.mean ? dist2(a.mean, b.mean) : 0
    const gap = gapScore[b.start - 1]
    // A long break counts like a strong change of scene. Without vectors, time alone decides.
    return w * (visual + (hasVecs ? 0.6 : 1) * gap * gap) + (hasVecs ? 0 : gap * 1e-6)
  }

  while (runs.length > k) {
    let best = 0
    let bestCost = Infinity
    for (let i = 0; i < runs.length - 1; i++) {
      const c = cost(runs[i], runs[i + 1])
      if (c < bestCost) (bestCost = c), (best = i)
    }
    const a = runs[best]
    const b = runs[best + 1]
    let mean: Float32Array | null = null
    if (a.mean && b.mean) {
      mean = new Float32Array(a.mean.length)
      for (let d = 0; d < mean.length; d++) mean[d] = (a.mean[d] * a.n + b.mean[d] * b.n) / (a.n + b.n)
    }
    runs = [...runs.slice(0, best), { start: a.start, n: a.n + b.n, mean }, ...runs.slice(best + 2)]
  }
  return runs.map((r) => r.start)
}

/** What a part shows: an English prompt for CLIP, and the Hebrew name it suggests. */
export const PART_LABELS: { prompt: string; name: string }[] = [
  { prompt: 'a photo of people getting ready, makeup and dressing up before an event', name: 'הכנות' },
  { prompt: 'a photo of guests arriving, hugging and greeting each other at a reception', name: 'הגעה וקבלת פנים' },
  { prompt: 'a photo of a ceremony with guests standing and watching', name: 'טקס' },
  { prompt: 'a photo of a wedding ceremony under a chuppah', name: 'חופה' },
  { prompt: 'a photo of a person giving a speech holding a microphone', name: 'נאומים וברכות' },
  { prompt: 'a photo of people dancing on a crowded dance floor at a party', name: 'ריקודים' },
  { prompt: 'a photo of people sitting and eating dinner at banquet tables', name: 'ארוחה' },
  { prompt: 'a photo of a cake and desserts, blowing out candles', name: 'עוגה וקינוח' },
  { prompt: 'a posed group photo of many people smiling at the camera', name: 'תמונות קבוצתיות' },
  { prompt: 'a portrait of a couple or a small family posing together', name: 'זוגות ומשפחה' },
  { prompt: 'a photo of young children playing', name: 'ילדים' },
  { prompt: 'a photo of people outdoors in a park or on a trip in nature', name: 'בחוץ' },
  { prompt: 'a photo of opening gifts and presents', name: 'מתנות' },
  { prompt: 'a photo of a live band or a performer on stage', name: 'הופעה' },
  { prompt: 'a photo of a decorated empty venue or scenery without people', name: 'המקום והעיצוב' },
]

/**
 * A distinct name for each part: the best matching label, strongest matches
 * first. Parts left without a label are numbered.
 */
export function nameParts(partVecs: (Float32Array | null)[], labelVecs: Float32Array[] | null): string[] {
  const names: (string | null)[] = partVecs.map(() => null)
  if (labelVecs) {
    const pairs: { part: number; label: number; score: number }[] = []
    partVecs.forEach((v, part) => {
      if (!v) return
      const norm = Math.hypot(...v) || 1
      labelVecs.forEach((l, label) => {
        let s = 0
        for (let d = 0; d < v.length; d++) s += v[d] * l[d]
        pairs.push({ part, label, score: s / norm })
      })
    })
    pairs.sort((a, b) => b.score - a.score)
    const used = new Set<number>()
    for (const { part, label } of pairs) {
      if (names[part] || used.has(label)) continue
      names[part] = PART_LABELS[label].name
      used.add(label)
    }
  }
  return names.map((n, i) => n ?? `חלק ${i + 1}`)
}

export function meanVec(vecs: Float32Array[]): Float32Array | null {
  if (!vecs.length) return null
  const m = new Float32Array(vecs[0].length)
  for (const v of vecs) for (let d = 0; d < m.length; d++) m[d] += v[d] / vecs.length
  return m
}
