import type { Caption } from './captions'

/**
 * Orders photos so each lands in a time slot whose sung line it fits best.
 * Slot times come from the beat schedule and don't depend on order, so this
 * only decides which photo goes in which slot.
 */

export interface Slot {
  start: number
  end: number
}

/** The caption line sung for most of a slot, or -1 for instrumental slots. */
export function lineForSlot(slot: Slot, captions: Caption[]): number {
  let best = -1
  let bestOverlap = 0
  captions.forEach((c, i) => {
    const overlap = Math.min(slot.end, c.end) - Math.max(slot.start, c.start)
    if (overlap > bestOverlap) (bestOverlap = overlap), (best = i)
  })
  return best
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Hungarian algorithm: the assignment of rows to columns with minimum total cost (square matrix). */
export function assign(cost: number[][]): number[] {
  const n = cost.length
  const INF = Number.POSITIVE_INFINITY
  const u = new Array(n + 1).fill(0)
  const v = new Array(n + 1).fill(0)
  const p = new Array(n + 1).fill(0)
  const way = new Array(n + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(n + 1).fill(INF)
    const used = new Array(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = INF
      let j1 = 0
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) (minv[j] = cur), (way[j] = j0)
        if (minv[j] < delta) (delta = minv[j]), (j1 = j)
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) (u[p[j]] += delta), (v[j] -= delta)
        else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }
  const rowToCol = new Array(n).fill(-1)
  for (let j = 1; j <= n; j++) if (p[j]) rowToCol[p[j] - 1] = j - 1
  return rowToCol
}

export interface StoryboardResult {
  /** Photo index for each slot, in slot order. */
  order: number[]
  /** Caption line index each slot was matched to, or -1. */
  lines: number[]
}

/**
 * photos: image vectors; lineVecs: one vector per caption line (null when the
 * line has no usable text); takenAt: for ordering photos in instrumental slots.
 */
export function storyboard(
  slots: Slot[],
  captions: Caption[],
  photoVecs: Float32Array[],
  lineVecs: (Float32Array | null)[],
  takenAt: number[],
): StoryboardResult {
  const n = slots.length
  const lines = slots.map((s) => lineForSlot(s, captions))
  // Similarity of every photo to every slot's line; instrumental slots score 0 for everyone.
  const sim = photoVecs.map((pv) =>
    lines.map((li) => {
      const lv = li >= 0 ? lineVecs[li] : null
      return lv ? dot(pv, lv) : 0
    }),
  )
  const photoForSlot = new Array<number>(n)
  const rowToCol = assign(sim.map((row) => row.map((s) => -s)))
  rowToCol.forEach((slot, photo) => (photoForSlot[slot] = photo))

  // Photos parked in instrumental slots keep their chronological order there.
  const quiet = lines.map((li, s) => (li < 0 || !lineVecs[li] ? s : -1)).filter((s) => s >= 0)
  const quietPhotos = quiet.map((s) => photoForSlot[s]).sort((a, b) => takenAt[a] - takenAt[b])
  quiet.forEach((s, k) => (photoForSlot[s] = quietPhotos[k]))

  return { order: photoForSlot, lines }
}
