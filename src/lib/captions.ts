export interface Caption {
  start: number
  end: number
  /** The line as sung (original language). */
  text: string
  /** Optional translated line shown with or instead of the original. */
  translation: string
  /** Set by automatic sync when none of the line's words were heard, so its timing is a guess. */
  estimated?: boolean
}

export type CaptionShow = 'original' | 'translation' | 'both'
export type CaptionPosition = 'bottom' | 'middle' | 'top'

export interface CaptionStyle {
  show: CaptionShow
  position: CaptionPosition
  /** Font size as a fraction of the video height. */
  size: number
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = { show: 'both', position: 'bottom', size: 0.055 }

/** Seconds a line stays up when nothing follows it. */
const LAST_LINE_SECONDS = 4

export function fromLines(original: string, translation = ''): Caption[] {
  const o = splitLines(original)
  const t = splitLines(translation)
  return Array.from({ length: Math.max(o.length, t.length) }, (_, i) => ({
    start: 0,
    end: 0,
    text: o[i] ?? '',
    translation: t[i] ?? '',
  }))
}

function splitLines(s: string) {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Pairs a list of translated lines with existing captions by order, keeping their timing. */
export function applyTranslation(captions: Caption[], translation: string): Caption[] {
  const t = splitLines(translation)
  return captions.map((c, i) => ({ ...c, translation: t[i] ?? c.translation }))
}

const LRC_TIME = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g

/**
 * LRC timed lyrics. Lines sharing a timestamp (a common way to ship a
 * translation inside the same file) become original + translation.
 */
export function parseLrc(src: string): Caption[] {
  const rows: { t: number; text: string }[] = []
  for (const line of src.split(/\r?\n/)) {
    const times = [...line.matchAll(LRC_TIME)]
    if (!times.length) continue
    const text = line.replace(LRC_TIME, '').trim()
    for (const m of times) rows.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text })
  }
  rows.sort((a, b) => a.t - b.t)
  const out: Caption[] = []
  for (const r of rows) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.start - r.t) < 0.01) {
      if (r.text) prev.translation = prev.translation ? `${prev.translation} ${r.text}` : r.text
    } else if (r.text) {
      out.push({ start: r.t, end: 0, text: r.text, translation: '' })
    } else if (prev && !prev.end) {
      // An empty timed line marks where the previous line ends.
      prev.end = r.t
    }
  }
  return fillEnds(out)
}

function srtTime(s: string) {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0
}

export function parseSrt(src: string): Caption[] {
  return src
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').filter((l) => l.trim())
      const i = lines.findIndex((l) => l.includes('-->'))
      if (i < 0) return null
      const [a, b] = lines[i].split('-->')
      const [text = '', ...rest] = lines.slice(i + 1)
      return { start: srtTime(a), end: srtTime(b), text, translation: rest.join(' ') }
    })
    .filter((c): c is Caption => !!c && !!c.text)
}

function fmtSrt(t: number) {
  const ms = Math.round(t * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

export function toSrt(captions: Caption[]) {
  return captions
    .map((c, i) => `${i + 1}\n${fmtSrt(c.start)} --> ${fmtSrt(c.end)}\n${[c.text, c.translation].filter(Boolean).join('\n')}\n`)
    .join('\n')
}

/** Each line ends where the next begins unless it already has an end. */
export function fillEnds(captions: Caption[]): Caption[] {
  return captions.map((c, i) => {
    const next = captions[i + 1]
    const end = c.end > c.start ? c.end : next && next.start > c.start ? next.start : c.start + LAST_LINE_SECONDS
    return { ...c, end: next && next.start > c.start ? Math.min(end, next.start) : end }
  })
}

/** Moves every start and end onto the nearest beat. */
export function snapToBeats(captions: Caption[], beats: number[]): Caption[] {
  if (!beats.length) return captions
  const near = (t: number) => beats.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a))
  return captions.map((c) => {
    const start = near(c.start)
    const end = near(c.end)
    return { ...c, start, end: end > start ? end : c.end }
  })
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line)
      line = w
    } else line = test
  }
  if (line) lines.push(line)
  return lines
}

export function drawCaptions(ctx: CanvasRenderingContext2D, captions: Caption[], style: CaptionStyle, t: number) {
  const c = captions.find((x) => t >= x.start && t < x.end)
  if (!c) return
  const { width: W, height: H } = ctx.canvas
  const big = Math.round(H * style.size)
  const small = Math.round(big * 0.72)

  const blocks: { text: string; px: number; weight: number }[] = []
  if (style.show !== 'translation' && c.text) blocks.push({ text: c.text, px: style.show === 'both' && c.translation ? small : big, weight: 600 })
  if (style.show !== 'original' && c.translation) blocks.push({ text: c.translation, px: big, weight: 700 })
  if (!blocks.length) return

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const laid = blocks.flatMap((b) => {
    ctx.font = `${b.weight} ${b.px}px system-ui, "Segoe UI", Arial, sans-serif`
    return wrap(ctx, b.text, W * 0.86).map((line) => ({ ...b, line }))
  })
  const lineH = (px: number) => px * 1.3
  const total = laid.reduce((s, l) => s + lineH(l.px), 0)
  let y =
    style.position === 'top' ? H * 0.08 : style.position === 'middle' ? (H - total) / 2 : H * 0.92 - total

  // A short fade at each edge keeps lines from popping.
  const fade = 0.15
  ctx.globalAlpha = Math.min(1, (t - c.start) / fade, (c.end - t) / fade)
  for (const l of laid) {
    ctx.font = `${l.weight} ${l.px}px system-ui, "Segoe UI", Arial, sans-serif`
    ctx.direction = RTL.test(l.line) ? 'rtl' : 'ltr'
    const cy = y + lineH(l.px) / 2
    ctx.lineWidth = Math.max(2, l.px * 0.14)
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(l.line, W / 2, cy)
    ctx.fillStyle = '#fff'
    ctx.fillText(l.line, W / 2, cy)
    y += lineH(l.px)
  }
  ctx.restore()
}
