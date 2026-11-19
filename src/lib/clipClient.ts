import type { ClipIn, ClipModel, ClipOut } from './clip.worker'
import type { Photo } from './types'

/** One CLIP worker for the whole app, so models and image vectors are shared between features. */

let worker: Worker | null = null
let nextId = 0
const imageVecs = new Map<string, Float32Array>()

type Request = ClipIn extends infer T ? (T extends ClipIn ? Omit<T, 'id'> : never) : never

export function clipCall(msg: Request, onStatus: (message: string) => void): Promise<Float32Array[]> {
  worker ??= new Worker(new URL('./clip.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  const id = nextId++
  const downloads = new Map<string, [number, number]>()
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<ClipOut>) => {
      const m = e.data
      if (m.type === 'download') {
        downloads.set(m.file, [m.loaded, m.total])
        const [l, t] = [...downloads.values()].reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0])
        onStatus(`מוריד מודל ניתוח תמונות (פעם ראשונה בלבד) ${t ? Math.round((l / t) * 100) : 0}%`)
        return
      }
      if (m.type === 'progress') return onStatus(`מנתח תמונות ${m.done}/${m.total}`)
      if (m.id !== id) return
      w.removeEventListener('message', onMessage)
      if (m.type === 'error') reject(new Error(m.message))
      else resolve(m.vectors)
    }
    w.addEventListener('message', onMessage)
    w.postMessage({ ...msg, id })
  })
}

/** Image vectors for photos, computed once per model and photo. */
export async function photoVectors(
  photos: Photo[],
  model: ClipModel,
  onStatus: (message: string) => void,
): Promise<Float32Array[]> {
  const key = (p: Photo) => `${model}:${p.id}`
  const missing = photos.filter((p) => !imageVecs.has(key(p)))
  if (missing.length) {
    const vecs = await clipCall({ kind: 'images', model, images: missing.map((p) => p.file) }, onStatus)
    missing.forEach((p, i) => imageVecs.set(key(p), vecs[i]))
  }
  return photos.map((p) => imageVecs.get(key(p))!)
}
