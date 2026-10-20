/// <reference lib="webworker" />
import {
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  type Tensor,
} from '@huggingface/transformers'

/**
 * Text and image embeddings in a shared space, so a lyric line can be scored
 * against each photo. Two models: OpenAI CLIP (English text, small) and Jina
 * CLIP v2 (multilingual text including Hebrew, much larger download).
 */

export type ClipModel = 'clip' | 'jina'
export type ClipIn =
  | { id: number; kind: 'texts'; model: ClipModel; texts: string[] }
  | { id: number; kind: 'images'; model: ClipModel; images: Blob[] }
export type ClipOut =
  | { type: 'download'; file: string; loaded: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | { id: number; type: 'result'; vectors: Float32Array[] }
  | { id: number; type: 'error'; message: string }

const post = (m: ClipOut) => self.postMessage(m)
const progress_callback = (d: { status: string; file?: string; loaded?: number; total?: number }) => {
  if (d.status === 'progress' && d.file) post({ type: 'download', file: d.file, loaded: d.loaded ?? 0, total: d.total ?? 0 })
}

const CLIP_ID = 'Xenova/clip-vit-base-patch32'
const JINA_ID = 'jinaai/jina-clip-v2'

type Loaded = {
  texts: (t: string[]) => Promise<Tensor>
  image: (img: RawImage) => Promise<Tensor>
}
const cache = new Map<string, Promise<Loaded>>()

function load(model: ClipModel, part: 'text' | 'vision'): Promise<Loaded> {
  const key = model === 'jina' ? 'jina' : `clip-${part}`
  let p = cache.get(key)
  if (p) return p
  p = (async (): Promise<Loaded> => {
    if (model === 'jina') {
      const processor = await AutoProcessor.from_pretrained(JINA_ID, { progress_callback })
      const m = await AutoModel.from_pretrained(JINA_ID, { dtype: 'q4', progress_callback })
      return {
        texts: async (t) => (await m(await processor(t, null, { padding: true, truncation: true }))).l2norm_text_embeddings,
        image: async (img) => (await m(await processor(null, img))).l2norm_image_embeddings,
      }
    }
    if (part === 'text') {
      const tokenizer = await AutoTokenizer.from_pretrained(CLIP_ID, { progress_callback })
      const m = await CLIPTextModelWithProjection.from_pretrained(CLIP_ID, { dtype: 'q8', progress_callback })
      return {
        texts: async (t) => (await m(tokenizer(t, { padding: true, truncation: true }))).text_embeds,
        image: () => Promise.reject(new Error('text model')),
      }
    }
    const processor = await AutoProcessor.from_pretrained(CLIP_ID, { progress_callback })
    const m = await CLIPVisionModelWithProjection.from_pretrained(CLIP_ID, { dtype: 'q8', progress_callback })
    return {
      texts: () => Promise.reject(new Error('vision model')),
      image: async (img) => (await m(await processor(img))).image_embeds,
    }
  })()
  p.catch(() => cache.delete(key))
  cache.set(key, p)
  return p
}

function rows(t: Tensor): Float32Array[] {
  const [n, d] = t.dims as [number, number]
  const data = t.data as Float32Array
  return Array.from({ length: n }, (_, i) => {
    const v = data.slice(i * d, (i + 1) * d)
    const norm = Math.hypot(...v) || 1
    return v.map((x) => x / norm)
  })
}

self.onmessage = async (e: MessageEvent<ClipIn>) => {
  const msg = e.data
  try {
    if (msg.kind === 'texts') {
      const m = await load(msg.model, 'text')
      post({ id: msg.id, type: 'result', vectors: rows(await m.texts(msg.texts)) })
    } else {
      const m = await load(msg.model, 'vision')
      const vectors: Float32Array[] = []
      for (let i = 0; i < msg.images.length; i++) {
        const img = await RawImage.fromBlob(msg.images[i])
        vectors.push(rows(await m.image(img))[0])
        post({ type: 'progress', done: i + 1, total: msg.images.length })
      }
      post({ id: msg.id, type: 'result', vectors })
    }
  } catch (err) {
    post({ id: msg.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
