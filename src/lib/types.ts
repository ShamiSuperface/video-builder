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
  refs: { url: string; blob: Blob; descriptor: Float32Array }[]
  /** Blur this person's face when the blur mode is "marked people". */
  blur?: boolean
}

export type MatchMode = 'any' | 'all'

export interface Clip {
  photoId: string
  filter: FilterName
  kenBurns: boolean
  /** Lyric line this photo was matched to by "arrange by lyrics". */
  lyric?: string
  /** Event part this photo belongs to (EventPart id). */
  part?: string
}

export type Transition = 'cut' | 'crossfade' | 'fadeBlack'

export interface Project {
  clips: Clip[]
  /** Seconds per clip when no music is loaded. */
  defaultDuration: number
  transition: Transition
  transitionDuration: number
  /** Cut every N beats when music is synced; 0 spreads the photos over the whole song; -1 uses defaultDuration seconds. */
  beatsPerCut: number
  blur?: BlurSettings
  /** Manual blur choices per photo id and face index; they win over the automatic mode. */
  faceBlur?: Record<string, Record<number, boolean>>
  /** Detected (and renamed) parts of the event. */
  parts?: EventPart[]
  /** Show each part's name over its first photo. */
  partTitles?: boolean
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

/**
 * Which faces to obscure automatically: none, people marked for blurring,
 * everyone who isn't one of the listed people, or every face.
 */
export type BlurMode = 'off' | 'marked' | 'others' | 'all'

export interface BlurSettings {
  mode: BlurMode
  style: 'blur' | 'pixelate'
}

export interface EventPart {
  id: string
  name: string
  photoIds: string[]
}
