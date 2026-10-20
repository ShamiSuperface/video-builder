import * as faceapi from '@vladmandic/face-api'
import { loadImage } from './photos'

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
