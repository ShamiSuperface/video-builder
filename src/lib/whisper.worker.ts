/// <reference lib="webworker" />
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

/**
 * Speech recognition off the main thread. The model downloads once from
 * Hugging Face and the browser caches it; the audio itself never leaves the device.
 */

export type WorkerIn = { audio: Float32Array; model: string; language: string }
export type WorkerOut =
  | { type: 'download'; file: string; loaded: number; total: number }
  | { type: 'status'; message: string }
  | { type: 'done'; words: { text: string; start: number; end: number }[]; wordLevel: boolean }
  | { type: 'error'; message: string }

const post = (m: WorkerOut) => self.postMessage(m)
const loaded = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>()

function load(model: string) {
  let p = loaded.get(model)
  if (!p) {
    const progress_callback = (d: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (d.status === 'progress' && d.file) post({ type: 'download', file: d.file, loaded: d.loaded ?? 0, total: d.total ?? 0 })
    }
    const make = (device: 'webgpu' | 'wasm') =>
      pipeline('automatic-speech-recognition', model, {
        device,
        dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        progress_callback,
      }) as Promise<AutomaticSpeechRecognitionPipeline>
    const hasGpu = 'gpu' in navigator
    p = (hasGpu ? make('webgpu').catch(() => make('wasm')) : make('wasm')).catch((e) => {
      loaded.delete(model)
      throw e
    })
    loaded.set(model, p)
  }
  return p
}

type Chunk = { text: string; timestamp: [number, number | null] }

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const { audio, model, language } = e.data
  try {
    post({ type: 'status', message: 'טוען מודל זיהוי דיבור…' })
    const asr = await load(model)
    post({ type: 'status', message: 'מקשיב לשיר ומזהה מילים…' })
    const opts = {
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe' as const,
      ...(language !== 'auto' ? { language } : {}),
    }
    let wordLevel = true
    let out: { chunks?: Chunk[] }
    try {
      out = (await asr(audio, { ...opts, return_timestamps: 'word' })) as { chunks?: Chunk[] }
    } catch {
      // Some model builds lack the attention outputs word timing needs; fall back to phrase timing.
      wordLevel = false
      out = (await asr(audio, { ...opts, return_timestamps: true })) as { chunks?: Chunk[] }
    }
    const words: { text: string; start: number; end: number }[] = []
    for (const c of out.chunks ?? []) {
      const [s, eRaw] = c.timestamp
      const end = eRaw ?? s + 0.5
      if (wordLevel) {
        words.push({ text: c.text, start: s, end })
      } else {
        // Spread a phrase's words evenly over its span.
        const ws = c.text.trim().split(/\s+/).filter(Boolean)
        ws.forEach((w, i) =>
          words.push({ text: w, start: s + ((end - s) * i) / ws.length, end: s + ((end - s) * (i + 1)) / ws.length }),
        )
      }
    }
    post({ type: 'done', words, wordLevel })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
