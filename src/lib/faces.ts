import * as faceapi from '@vladmandic/face-api'
import { loadImage } from './photos'
import type { Rect } from './kenburns'

const MODEL_URL = `${import.meta.env.BASE_URL}models`
/** Faces are detected on a downscaled copy; large photos are slow and gain little accuracy. */
const SCAN_MAX_SIDE = 800

let modelsReady: Promise<void> | null = null

export function loadModels() {
  modelsReady ??= (async () => {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
  })()
  return modelsReady
}

function downscale(img: HTMLImageElement): HTMLCanvasElement {
  const scale = Math.min(1, SCAN_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * scale)
  c.height = Math.round(img.naturalHeight * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c
}

export async function describeFaces(url: string): Promise<Float32Array[]> {
  await loadModels()
  const canvas = downscale(await loadImage(url))
  const results = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors()
  return results.map((r) => r.descriptor)
}

const boxCache = new Map<string, Promise<Rect[]>>()

/** Face boxes in the photo's own pixels, for framing. Detection only (no descriptors), cached per image. */
export function faceBoxes(url: string): Promise<Rect[]> {
  let p = boxCache.get(url)
  if (!p) {
    p = (async () => {
      await loadModels()
      const img = await loadImage(url)
      const canvas = downscale(img)
      const scale = img.naturalWidth / canvas.width
      const dets = await faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      return dets.map(({ box }) => ({ x: box.x * scale, y: box.y * scale, w: box.width * scale, h: box.height * scale }))
    })().catch(() => [])
    boxCache.set(url, p)
  }
  return p
}

/** Reference descriptors for the person to find: the largest face in each reference photo. */
export async function referenceDescriptor(url: string): Promise<Float32Array | null> {
  await loadModels()
  const canvas = downscale(await loadImage(url))
  const results = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors()
  if (!results.length) return null
  const biggest = results.reduce((a, b) => (a.detection.box.area > b.detection.box.area ? a : b))
  return biggest.descriptor
}

/** Smallest distance between any face in the photo and any reference descriptor. */
export function bestDistance(faces: Float32Array[], refs: Float32Array[]): number {
  let best = Infinity
  for (const f of faces) for (const r of refs) best = Math.min(best, faceapi.euclideanDistance(f, r))
  return best
}

/**
 * Which people appear in a photo. Each face is assigned to at most one person
 * (closest first), so two look-alike people can't both claim the same face.
 */
export function matchPeople(
  faces: Float32Array[],
  people: { id: string; refs: { descriptor: Float32Array }[] }[],
  threshold: number,
): Map<string, number> {
  const pairs: { face: number; person: string; d: number }[] = []
  faces.forEach((f, fi) =>
    people.forEach((p) => {
      const d = bestDistance([f], p.refs.map((r) => r.descriptor))
      if (d <= threshold) pairs.push({ face: fi, person: p.id, d })
    }),
  )
  pairs.sort((a, b) => a.d - b.d)
  const usedFaces = new Set<number>()
  const found = new Map<string, number>()
  for (const { face, person, d } of pairs) {
    if (usedFaces.has(face) || found.has(person)) continue
    usedFaces.add(face)
    found.set(person, d)
  }
  return found
}
