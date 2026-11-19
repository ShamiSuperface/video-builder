import { identifyFaces, type FaceDetail } from './faces'
import type { Rect } from './kenburns'
import type { BlurSettings, Person } from './types'

/**
 * Face blurring. Which faces to hide is decided once per photo (automatic mode
 * plus manual choices); drawing then covers those rects wherever the photo is
 * drawn, so the blur follows the face through zooms and transitions.
 */

export const DEFAULT_BLUR: BlurSettings = { mode: 'off', style: 'blur' }

/** Whether each face in a photo is blurred: the automatic choice unless a manual one overrides it. */
export function blurDecisions(
  faces: FaceDetail[],
  people: Person[],
  threshold: number,
  settings: BlurSettings,
  overrides: Record<number, boolean> = {},
): { who: (string | null)[]; auto: boolean[]; blurred: boolean[] } {
  const withRefs = people.filter((p) => p.refs.length)
  const who = identifyFaces(
    faces.map((f) => f.descriptor),
    withRefs,
    threshold,
  )
  const marked = new Set(withRefs.filter((p) => p.blur).map((p) => p.id))
  const auto = who.map((id) => {
    if (settings.mode === 'all') return true
    if (settings.mode === 'others') return id === null
    if (settings.mode === 'marked') return id !== null && marked.has(id)
    return false
  })
  return { who, auto, blurred: auto.map((a, i) => overrides[i] ?? a) }
}

const scratch = typeof document !== 'undefined' ? document.createElement('canvas') : null

/** Area actually hidden around a detected face: detections are tight, so widen to cover hair and chin. */
export function coverArea(r: Rect, iw: number, ih: number): Rect {
  const x = Math.max(0, r.x - r.w * 0.2)
  const y = Math.max(0, r.y - r.h * 0.35)
  return { x, y, w: Math.min(iw, r.x + r.w * 1.2) - x, h: Math.min(ih, r.y + r.h * 1.25) - y }
}

/**
 * Covers faces on a canvas where `crop` (image pixels) was drawn over the whole
 * canvas. Shrinks each face to a few cells and scales it back up: smooth for
 * blur, blocky for pixelate. Works in every browser, unlike ctx.filter blur.
 */
export function obscureFaces(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number },
  crop: Rect,
  rects: Rect[],
  style: BlurSettings['style'],
) {
  if (!rects.length || !scratch) return
  const { width: W, height: H } = ctx.canvas
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const sx = W / crop.w
  const sy = H / crop.h
  const t = scratch.getContext('2d')!
  for (const face of rects) {
    const a = coverArea(face, iw, ih)
    if (a.w <= 0 || a.h <= 0) continue
    const dx = (a.x - crop.x) * sx
    const dy = (a.y - crop.y) * sy
    const dw = a.w * sx
    const dh = a.h * sy
    if (dx > W || dy > H || dx + dw < 0 || dy + dh < 0) continue
    // Few enough cells that the face can't be recognised, at any size.
    const cells = style === 'pixelate' ? 7 : 4
    const tw = cells
    const th = Math.max(2, Math.round((cells * a.h) / a.w))
    scratch.width = tw
    scratch.height = th
    t.imageSmoothingEnabled = true
    t.drawImage(img, a.x, a.y, a.w, a.h, 0, 0, tw, th)
    ctx.save()
    ctx.beginPath()
    if (style === 'pixelate') ctx.rect(dx, dy, dw, dh)
    else ctx.ellipse(dx + dw / 2, dy + dh / 2, dw / 2, dh / 2, 0, 0, Math.PI * 2)
    ctx.clip()
    ctx.imageSmoothingEnabled = style === 'blur'
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(scratch, 0, 0, tw, th, dx, dy, dw, dh)
    ctx.restore()
  }
}

/** The whole photo with its filter and blurred faces, as a JPEG, for exporting photos. */
export async function renderPhoto(
  img: HTMLImageElement,
  filterCss: string,
  rects: Rect[],
  style: BlurSettings['style'],
  maxSide = 3000,
): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * scale)
  c.height = Math.round(img.naturalHeight * scale)
  const ctx = c.getContext('2d')!
  ctx.filter = filterCss
  const full = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
  ctx.drawImage(img, 0, 0, c.width, c.height)
  obscureFaces(ctx, img, full, rects, style)
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92),
  )
}
