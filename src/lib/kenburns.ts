/**
 * Ken Burns framing. A move goes between a wide crop and a close crop of the
 * photo, both with the video's aspect ratio. When faces are known, both crops
 * are placed to keep every face inside (or, if they can't all fit, centred on
 * them), so the motion settles on people instead of sliding them out of frame.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** How much closer the close crop is than the wide one. */
const MAX_ZOOM = 1.18
/** Breathing room around faces, as a fraction of the face box size. */
const FACE_PAD = 0.6

function clampInto(r: Rect, iw: number, ih: number): Rect {
  return { ...r, x: Math.min(Math.max(0, r.x), iw - r.w), y: Math.min(Math.max(0, r.y), ih - r.h) }
}

/** Largest crop of the given aspect that fits the image, centred on (cx, cy) as far as the edges allow. */
function coverCrop(iw: number, ih: number, aspect: number, cx: number, cy: number): Rect {
  const w = Math.min(iw, ih * aspect)
  const h = w / aspect
  return clampInto({ x: cx - w / 2, y: cy - h / 2, w, h }, iw, ih)
}

/** Union of face boxes (image pixels), padded so heads and chins aren't on the edge. */
export function faceRegion(faces: Rect[]): Rect | null {
  if (!faces.length) return null
  const x0 = Math.min(...faces.map((f) => f.x))
  const y0 = Math.min(...faces.map((f) => f.y))
  const x1 = Math.max(...faces.map((f) => f.x + f.w))
  const y1 = Math.max(...faces.map((f) => f.y + f.h))
  const size = Math.max(...faces.map((f) => Math.max(f.w, f.h)))
  const pad = size * FACE_PAD
  // A little extra below the faces keeps shoulders and smiles in the shot.
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + pad * 2.4 }
}

export interface Move {
  from: Rect
  to: Rect
}

/**
 * The wide and close crops for one clip. zoomIn alternates per clip so a
 * sequence doesn't always push in.
 */
export function planMove(iw: number, ih: number, aspect: number, faces: Rect[], zoomIn: boolean, index: number): Move {
  const region = faceRegion(faces)
  let wide: Rect
  let close: Rect
  if (region) {
    const cx = region.x + region.w / 2
    const cy = region.y + region.h / 2
    wide = coverCrop(iw, ih, aspect, cx, cy)
    // Faces spread wider (or taller) than any crop can hold: pan across them instead of
    // centring on the gap between them.
    const left = Math.min(...faces.map((f) => f.x))
    const top = Math.min(...faces.map((f) => f.y))
    const rawW = Math.max(...faces.map((f) => f.x + f.w)) - left
    const rawH = Math.max(...faces.map((f) => f.y + f.h)) - top
    if (rawW > wide.w * 0.9 || rawH > wide.h * 0.9) {
      if (faces.length === 1) {
        // A close-up bigger than the frame: hold on the eyes with only a slight push.
        const f = faces[0]
        const eyes = coverCrop(iw, ih, aspect, f.x + f.w / 2, f.y + f.h * 0.4)
        const w = eyes.w / 1.06
        const tight = clampInto({ x: eyes.x + (eyes.w - w) / 2, y: eyes.y + (eyes.h - w / aspect) / 2, w, h: w / aspect }, iw, ih)
        return zoomIn ? { from: eyes, to: tight } : { from: tight, to: eyes }
      }
      // A group spread wider (or taller) than the frame: pan from one end of the faces to the other
      // instead of centring on the gap between them.
      const a = coverCrop(iw, ih, aspect, left + wide.w / 2 - wide.w * 0.1, top + wide.h / 2 - wide.h * 0.1)
      const b = coverCrop(iw, ih, aspect, left + rawW - wide.w / 2 + wide.w * 0.1, top + rawH - wide.h / 2 + wide.h * 0.1)
      return index % 2 === 0 ? { from: a, to: b } : { from: b, to: a }
    }
    // Close crop: tighter by MAX_ZOOM, but never tighter than the faces need.
    const needW = Math.max(region.w, region.h * aspect)
    const w = Math.min(wide.w, Math.max(wide.w / MAX_ZOOM, needW))
    close = clampInto({ x: cx - w / 2, y: cy - w / aspect / 2, w, h: w / aspect }, iw, ih)
  } else {
    // No faces: drift gently toward a corner that alternates per clip, staying a little above centre.
    wide = coverCrop(iw, ih, aspect, iw / 2, ih / 2)
    const w = wide.w / MAX_ZOOM
    const dx = index % 4 < 2 ? 0.35 : 0.65
    close = clampInto({ x: iw * dx - w / 2, y: ih * 0.45 - w / aspect / 2, w, h: w / aspect }, iw, ih)
  }
  return zoomIn ? { from: wide, to: close } : { from: close, to: wide }
}

const ease = (p: number) => p * p * (3 - 2 * p)

export function cropAt(move: Move, p: number): Rect {
  const e = ease(Math.min(1, Math.max(0, p)))
  const lerp = (a: number, b: number) => a + (b - a) * e
  return {
    x: lerp(move.from.x, move.to.x),
    y: lerp(move.from.y, move.to.y),
    w: lerp(move.from.w, move.to.w),
    h: lerp(move.from.h, move.to.h),
  }
}
