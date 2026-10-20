export type FilterName = 'none' | 'bw' | 'sepia' | 'warm' | 'cool' | 'vivid' | 'fade'

export interface Photo {
  id: string
  file: File
  name: string
  path: string
  url: string
  /** Capture time from EXIF, falling back to the file's lastModified. */
  takenAt: number
  hasExifDate: boolean
  /** Descriptors of every face in the photo; undefined until scanned. */
  faces?: Float32Array[]
}

export interface Person {
  id: string
  name: string
  refs: { url: string; descriptor: Float32Array }[]
}

export type MatchMode = 'any' | 'all'

export interface Clip {
  photoId: string
  filter: FilterName
  kenBurns: boolean
}

export type Transition = 'cut' | 'crossfade' | 'fadeBlack'

export interface Project {
  clips: Clip[]
  /** Seconds per clip when no music is loaded. */
  defaultDuration: number
  transition: Transition
  transitionDuration: number
  /** Cut every N beats when music is synced. */
  beatsPerCut: number
  width: number
  height: number
}

export interface Track {
  file: File
  url: string
  buffer: AudioBuffer
  beats: number[]
  bpm: number
}
