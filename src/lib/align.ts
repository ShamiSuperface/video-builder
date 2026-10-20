import type { Caption } from './captions'

/** A word heard in the song, from speech recognition. */
export interface HeardWord {
  text: string
  start: number
  end: number
}

/** Lowercase, drop accents/niqqud and punctuation so "Don't," matches "dont". */
export function normalize(w: string) {
  return w
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function similarity(a: string, b: string) {
  if (a === b) return 1
  if (!a || !b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length)
}

const GAP = -0.4
const MIN_SIM = 0.6

/**
 * Global alignment (Needleman-Wunsch) of the written lyrics against the heard
 * words. Gaps are cheap because recognition both misses words and invents
 * them, especially over loud music. Returns, per lyric word, the index of the
 * heard word it matched, or -1.
 */
export function alignWords(lyrics: string[], heard: string[]): number[] {
  const n = lyrics.length
  const m = heard.length
  const score = Array.from({ length: n + 1 }, () => new Float32Array(m + 1))
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)) // 0 diag, 1 up, 2 left
  for (let i = 1; i <= n; i++) (score[i][0] = i * GAP), (move[i][0] = 1)
  for (let j = 1; j <= m; j++) (score[0][j] = j * GAP), (move[0][j] = 2)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = similarity(lyrics[i - 1], heard[j - 1])
      const diag = score[i - 1][j - 1] + (s >= MIN_SIM ? 1 + s : -1)
      const up = score[i - 1][j] + GAP
      const left = score[i][j - 1] + GAP
      if (diag >= up && diag >= left) (score[i][j] = diag), (move[i][j] = 0)
      else if (up >= left) (score[i][j] = up), (move[i][j] = 1)
      else (score[i][j] = left), (move[i][j] = 2)
    }
  }
  const out = new Array<number>(n).fill(-1)
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const mv = move[i][j]
    if (mv === 0) {
      if (similarity(lyrics[i - 1], heard[j - 1]) >= MIN_SIM) out[i - 1] = j - 1
      i--
      j--
    } else if (mv === 1) i--
    else j--
  }
  return out
}

export interface AlignResult {
  captions: Caption[]
  /** Share of lyric words that were actually heard (0-1). */
  matched: number
}

/** Seconds a line lingers after its last word, unless the next line starts sooner. */
const TAIL = 0.4

/**
 * Times each caption line from the heard words. Lines whose words were heard
 * take their times directly; the rest are spread evenly between their
 * neighbours and flagged as estimated. Translations ride along with their line.
 */
export function alignCaptions(captions: Caption[], words: HeardWord[], duration: number): AlignResult {
  const lyricWords: { norm: string; line: number }[] = []
  captions.forEach((c, line) =>
    c.text
      .split(/\s+/)
      .map(normalize)
      .filter(Boolean)
      .forEach((norm) => lyricWords.push({ norm, line })),
  )
  const heard = words.map((w) => ({ ...w, norm: normalize(w.text) })).filter((w) => w.norm)
  const match = alignWords(
    lyricWords.map((w) => w.norm),
    heard.map((w) => w.norm),
  )
  const matchedCount = match.filter((m) => m >= 0).length
  if (!matchedCount) return { captions, matched: 0 }

  // Word times: matched words take the heard times; others are interpolated by position.
  const starts = new Array<number | undefined>(lyricWords.length)
  const ends = new Array<number | undefined>(lyricWords.length)
  match.forEach((m, k) => {
    if (m >= 0) (starts[k] = heard[m].start), (ends[k] = heard[m].end)
  })
  const known = starts.map((s, k) => (s === undefined ? -1 : k)).filter((k) => k >= 0)
  const WORD = 0.4 // assumed seconds per word where nothing anchors the estimate
  for (let k = 0; k < lyricWords.length; k++) {
    if (starts[k] !== undefined) continue
    const b = [...known].reverse().find((x) => x < k)
    const a = known.find((x) => x > k)
    let start: number
    let len = WORD
    if (b !== undefined && a !== undefined) {
      len = (starts[a]! - ends[b]!) / (a - b)
      start = ends[b]! + len * (k - b - 1)
    } else if (a !== undefined) start = Math.max(0, starts[a]! - (a - k) * WORD)
    else start = Math.min(duration, ends[b!]! + (k - b! - 1) * WORD)
    starts[k] = start
    ends[k] = start + Math.max(0.15, len)
  }

  const timed = captions.map((c, line) => {
    const idx = lyricWords.map((w, k) => (w.line === line ? k : -1)).filter((k) => k >= 0)
    if (!idx.length) return { ...c, start: 0, end: 0, estimated: true }
    const heardInLine = idx.filter((k) => match[k] >= 0).length
    return {
      ...c,
      start: starts[idx[0]]!,
      end: ends[idx[idx.length - 1]]! + TAIL,
      estimated: heardInLine === 0,
    }
  })
  // Lines with no words at all sit between their neighbours; then keep lines in order and non-overlapping.
  for (let i = 0; i < timed.length; i++) {
    if (timed[i].end > 0) continue
    const prev = timed[i - 1]
    const next = timed.slice(i + 1).find((x) => x.end > 0)
    timed[i].start = prev ? prev.end : 0
    timed[i].end = next ? next.start : timed[i].start + 2
  }
  for (let i = 0; i < timed.length; i++) {
    if (i > 0 && timed[i].start < timed[i - 1].start) timed[i].start = timed[i - 1].end
    const next = timed[i + 1]
    if (next && timed[i].end > next.start) timed[i].end = Math.max(timed[i].start + 0.2, next.start)
    timed[i].end = Math.min(timed[i].end, duration)
  }
  return { captions: timed, matched: matchedCount / lyricWords.length }
}

/** Without written lyrics: group heard words into readable lines at pauses or length limits. */
export function linesFromWords(words: HeardWord[], translation: string[] = []): Caption[] {
  const lines: HeardWord[][] = []
  let cur: HeardWord[] = []
  for (const w of words) {
    const last = cur[cur.length - 1]
    const text = cur.map((x) => x.text.trim()).join(' ')
    if (cur.length && (w.start - last.end > 0.6 || cur.length >= 8 || text.length > 38)) {
      lines.push(cur)
      cur = []
    }
    cur.push(w)
  }
  if (cur.length) lines.push(cur)
  return lines.map((ws, i) => ({
    start: ws[0].start,
    end: Math.min(ws[ws.length - 1].end + TAIL, lines[i + 1]?.[0].start ?? Infinity),
    text: ws
      .map((w) => w.text.trim())
      .join(' ')
      .trim(),
    translation: translation[i] ?? '',
  }))
}
