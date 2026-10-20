import type { Caption, CaptionStyle } from './captions'
import type { Clip, MatchMode, Project } from './types'

/**
 * Drafts live in this browser's IndexedDB. Photos and the song are stored as
 * the original files (structured clone keeps File/Blob/Float32Array), so a
 * draft reopens without picking folders again.
 */

export interface DraftPhoto {
  id: string
  file: File
  path: string
  takenAt: number
  hasExifDate: boolean
  faces?: Float32Array[]
}

export interface DraftData {
  photos: DraftPhoto[]
  people: { id: string; name: string; refs: { blob: Blob; descriptor: Float32Array }[] }[]
  matchMode: MatchMode
  threshold: number
  project: Omit<Project, 'width' | 'height'> & { clips: Clip[] }
  format: string
  track: { file: File; beats: number[]; bpm: number } | null
  captions: Caption[]
  captionStyle: CaptionStyle
}

export interface Draft {
  id: string
  name: string
  updatedAt: number
  /** Small preview shown in the draft list. */
  thumb?: Blob
  data: DraftData
}

export type DraftSummary = Omit<Draft, 'data'> & { photoCount: number; clipCount: number }

const DB = 'video-builder'
const STORE = 'drafts'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close()) as Promise<T>
}

export async function saveDraft(draft: Draft) {
  // Ask the browser not to evict drafts under storage pressure; harmless if refused.
  navigator.storage?.persist?.().catch(() => {})
  await tx('readwrite', (s) => s.put(draft))
}

export const loadDraft = (id: string) => tx<Draft | undefined>('readonly', (s) => s.get(id))

export const deleteDraft = (id: string) => tx('readwrite', (s) => s.delete(id))

export async function listDrafts(): Promise<DraftSummary[]> {
  const all = await tx<Draft[]>('readonly', (s) => s.getAll())
  return all
    .map(({ data, ...rest }) => ({ ...rest, photoCount: data.photos.length, clipCount: data.project.clips.length }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function makeThumb(file: Blob, size = 160): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = size / Math.max(bmp.width, bmp.height)
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    return await new Promise<Blob | undefined>((r) => c.toBlob((b) => r(b ?? undefined), 'image/jpeg', 0.8))
  } catch {
    return undefined
  }
}
