import type { Clip, FilterName, Photo, Project } from './types'
import { loadImage } from './photos'

export const FILTERS: Record<FilterName, { label: string; css: string }> = {
  none: { label: 'ללא', css: 'none' },
  bw: { label: 'שחור-לבן', css: 'grayscale(1) contrast(1.1)' },
  sepia: { label: 'ספיה', css: 'sepia(0.8) contrast(1.05)' },
  warm: { label: 'חמים', css: 'sepia(0.25) saturate(1.3) hue-rotate(-10deg)' },
  cool: { label: 'קריר', css: 'saturate(0.9) hue-rotate(15deg) brightness(1.05)' },
  vivid: { label: 'חי', css: 'saturate(1.6) contrast(1.15)' },
  fade: { label: 'דהוי', css: 'contrast(0.85) brightness(1.1) saturate(0.7)' },
}

export interface ScheduledClip {
  clip: Clip
  photo: Photo
  start: number
  end: number
}

/** Beats per photo. 0 means automatic: spread the photos over the whole song. */
export function cutEvery(project: Project, beats?: number[]) {
  if (project.beatsPerCut > 0) return project.beatsPerCut
  if (!beats?.length || !project.clips.length) return 2
  return Math.max(1, Math.floor((beats.length - 1) / project.clips.length))
}

/** Clip start/end times: on every Nth beat when music is synced, otherwise a fixed duration. */
export function schedule(project: Project, photos: Map<string, Photo>, beats?: number[]): ScheduledClip[] {
  const n = cutEvery(project, beats)
  const cuts = beats?.length ? beats.filter((_, i) => i > 0 && i % n === 0) : []
  const out: ScheduledClip[] = []
  let t = 0
  project.clips.forEach((clip, i) => {
    const photo = photos.get(clip.photoId)
    if (!photo) return
    const end = cuts[i] ?? t + project.defaultDuration
    out.push({ clip, photo, start: t, end })
    t = end
  })
  return out
}

export function totalDuration(s: ScheduledClip[]) {
  return s.length ? s[s.length - 1].end : 0
}

export async function preload(s: ScheduledClip[]) {
  const map = new Map<string, HTMLImageElement>()
  await Promise.all(s.map(async ({ photo }) => map.set(photo.url, await loadImage(photo.url))))
  return map
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sc: ScheduledClip,
  index: number,
  t: number,
  alpha: number,
) {
  const { width: W, height: H } = ctx.canvas
  const p = Math.min(1, Math.max(0, (t - sc.start) / Math.max(0.01, sc.end - sc.start)))
  // Cover fit, then a slow zoom and pan whose direction alternates per clip.
  const base = Math.max(W / img.naturalWidth, H / img.naturalHeight)
  const zoom = sc.clip.kenBurns ? (index % 2 ? 1.12 - 0.12 * p : 1 + 0.12 * p) : 1
  const w = img.naturalWidth * base * zoom
  const h = img.naturalHeight * base * zoom
  const dir = index % 4 < 2 ? 1 : -1
  const pan = sc.clip.kenBurns ? (p - 0.5) * dir : 0
  const x = (W - w) / 2 + pan * (w - W) * 0.8
  const y = (H - h) / 2 + pan * (h - H) * 0.4
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.filter = FILTERS[sc.clip.filter].css
  ctx.drawImage(img, x, y, w, h)
  ctx.restore()
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  s: ScheduledClip[],
  images: Map<string, HTMLImageElement>,
  project: Project,
  t: number,
) {
  const { width: W, height: H } = ctx.canvas
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const i = s.findIndex((c) => t >= c.start && t < c.end)
  if (i < 0) return
  const cur = s[i]
  const next = s[i + 1]
  const img = images.get(cur.photo.url)
  if (!img) return
  const td = Math.min(project.transitionDuration, (cur.end - cur.start) / 2)
  const into = cur.end - t // seconds left in this clip

  if (project.transition === 'crossfade' && next && into < td) {
    drawClip(ctx, img, cur, i, t, 1)
    const nimg = images.get(next.photo.url)
    if (nimg) drawClip(ctx, nimg, next, i + 1, next.start, 1 - into / td)
    return
  }
  drawClip(ctx, img, cur, i, t, 1)
  if (project.transition === 'fadeBlack') {
    const half = td / 2
    const sinceStart = t - cur.start
    let dark = 0
    if (next && into < half) dark = 1 - into / half
    else if (i > 0 && sinceStart < half) dark = 1 - sinceStart / half
    if (dark > 0) {
      ctx.fillStyle = `rgba(0,0,0,${dark})`
      ctx.fillRect(0, 0, W, H)
    }
  }
}

export function pickRecorderMime() {
  const options = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}
