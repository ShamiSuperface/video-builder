import exifr from 'exifr'
import type { Photo } from './types'

const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i

export function isImage(file: File) {
  return file.type.startsWith('image/') || IMAGE_RE.test(file.name)
}

async function readTakenAt(file: File): Promise<number | undefined> {
  try {
    const tags = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate'])
    const d: Date | undefined = tags?.DateTimeOriginal ?? tags?.CreateDate ?? tags?.ModifyDate
    return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : undefined
  } catch {
    return undefined
  }
}

/** Turns a folder selection into photos, sorted by capture time. */
export async function loadPhotos(
  files: Iterable<File>,
  onProgress?: (done: number, total: number) => void,
): Promise<Photo[]> {
  const images = [...files].filter(isImage)
  const photos: Photo[] = []
  let done = 0
  // Small batches keep EXIF parsing from flooding the main thread.
  for (let i = 0; i < images.length; i += 16) {
    const batch = images.slice(i, i + 16)
    const parsed = await Promise.all(
      batch.map(async (file) => {
        const exifTime = await readTakenAt(file)
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        return {
          id: `${path}:${file.size}:${file.lastModified}`,
          file,
          name: file.name,
          path,
          url: URL.createObjectURL(file),
          takenAt: exifTime ?? file.lastModified,
          hasExifDate: exifTime !== undefined,
        } satisfies Photo
      }),
    )
    photos.push(...parsed)
    done += batch.length
    onProgress?.(done, images.length)
  }
  return sortByDate(photos)
}

export function sortByDate<T extends { takenAt: number }>(photos: T[]): T[] {
  return [...photos].sort((a, b) => a.takenAt - b.takenAt)
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
    imageCache.set(url, p)
  }
  return p
}
