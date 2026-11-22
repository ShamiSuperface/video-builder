import type { Clip, FilterName, Photo, Project } from './types'
import { loadImage } from './photos'
import { faceBoxes } from './faces'
import { cropAt, planMove, type Rect } from './kenburns'
import { obscureFaces } from './blur'
import type { BlurSettings } from './types'

/** Faces to blur, by photo URL, in the photo's own pixels. */
export interface BlurMap {
  rects: Map<string, Rect[]>
  style: BlurSettings['style']
}

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

/** Beats per photo. 0 means automatic: spread the photos over the whole song. -1: fixed seconds (see schedule). */
export function cutEvery(project: Project, beats?: number[]) {
  if (project.beatsPerCut !== 0) return project.beatsPerCut
  if (!beats?.length || !project.clips.length) return 2
  return Math.max(1, Math.floor((beats.length - 1) / project.clips.length))
}

/** Clip start/end times: on every Nth beat when music is synced, otherwise a fixed duration. */
export function schedule(project: Project, photos: Map<string, Photo>, beats?: number[]): ScheduledClip[] {
  const n = cutEvery(project, beats)
  const cuts = beats?.length && n > 0 ? beats.filter((_, i) => i > 0 && i % n === 0) : []
  const out: ScheduledClip[] = []
  let t = 0
  const dur = project.defaultDuration
  project.clips.forEach((clip, i) => {
    const photo = photos.get(clip.photoId)
    if (!photo) return
    // Fixed seconds with music: cut on the beat nearest the requested length, so cuts stay on the rhythm.
    const end = n < 0 ? nearestBeat(beats, t + dur, t + dur * 0.6) : (cuts[i] ?? t + dur)
    out.push({ clip, photo, start: t, end })
    t = end
  })
  return out
}

function nearestBeat(beats: number[] | undefined, target: number, min: number) {
  let best = target
  let bestD = Infinity
  for (const b of beats ?? []) {
    if (b <= min) continue
    const d = Math.abs(b - target)
    if (d < bestD) (bestD = d), (best = b)
    else if (b > target) break
  }
  return bestD <= 0.6 ? best : target
}

export function totalDuration(s: ScheduledClip[]) {
  return s.length ? s[s.length - 1].end : 0
}

/** Face boxes per photo URL, filled by preload so drawing stays synchronous. */
const faces = new Map<string, Rect[]>()

export async function preload(s: ScheduledClip[], withFaces = true) {
  const map = new Map<string, HTMLImageElement>()
  await Promise.all(s.map(async ({ photo }) => map.set(photo.url, await loadImage(photo.url))))
  // Framing follows faces; detect them one at a time to keep the page responsive.
  if (withFaces) for (const { photo } of s) if (!faces.has(photo.url)) faces.set(photo.url, await faceBoxes(photo.url))
  return map
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sc: ScheduledClip,
  index: number,
  t: number,
  alpha: number,
  blur?: BlurMap,
) {
  const { width: W, height: H } = ctx.canvas
  const p = Math.min(1, Math.max(0, (t - sc.start) / Math.max(0.01, sc.end - sc.start)))
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  // Zoom in and out alternate per clip; both ends of the move keep the faces in frame.
  const move = planMove(iw, ih, W / H, faces.get(sc.photo.url) ?? [], index % 2 === 0, index)
  const crop = sc.clip.kenBurns ? cropAt(move, p) : planMove(iw, ih, W / H, faces.get(sc.photo.url) ?? [], true, index).from
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.filter = FILTERS[sc.clip.filter].css
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H)
  const hide = blur?.rects.get(sc.photo.url)
  if (hide?.length) obscureFaces(ctx, img, crop, hide, blur!.style)
  ctx.restore()
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  s: ScheduledClip[],
  images: Map<string, HTMLImageElement>,
  project: Project,
  t: number,
  blur?: BlurMap,
) {
  drawPhotos(ctx, s, images, project, t, blur)
  if (project.partTitles) drawPartTitle(ctx, s, project, t)
}

/** The part's name fades in over the first photo of each part. */
function drawPartTitle(ctx: CanvasRenderingContext2D, s: ScheduledClip[], project: Project, t: number) {
  const i = s.findIndex((c) => t >= c.start && t < c.end)
  const cur = s[i]
  if (!cur?.clip.part || s[i - 1]?.clip.part === cur.clip.part) return
  const name = project.parts?.find((p) => p.id === cur.clip.part)?.name.trim()
  if (!name) return
  const len = Math.min(2.5, cur.end - cur.start)
  const since = t - cur.start
  if (since > len) return
  const fade = 0.4
  // The video's first title is shown at once, so it also appears on the still preview.
  const alpha = Math.min(1, i === 0 ? 1 : since / fade, (len - since) / fade)
  const { width: W, height: H } = ctx.canvas
  const size = Math.round(Math.min(W, H) * 0.075)
  ctx.save()
  ctx.globalAlpha = Math.max(0, alpha)
  ctx.direction = 'rtl'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${size}px "Segoe UI", Arial, sans-serif`
  const y = H * 0.16
  const w = Math.min(W * 0.9, ctx.measureText(name).width + size * 1.6)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.beginPath()
  ctx.roundRect(W / 2 - w / 2, y - size * 0.85, w, size * 1.7, size * 0.4)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.fillText(name, W / 2, y, W * 0.85)
  ctx.restore()
}

function drawPhotos(
  ctx: CanvasRenderingContext2D,
  s: ScheduledClip[],
  images: Map<string, HTMLImageElement>,
  project: Project,
  t: number,
  blur?: BlurMap,
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
    drawClip(ctx, img, cur, i, t, 1, blur)
    const nimg = images.get(next.photo.url)
    if (nimg) drawClip(ctx, nimg, next, i + 1, next.start, 1 - into / td, blur)
    return
  }
  drawClip(ctx, img, cur, i, t, 1, blur)
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
