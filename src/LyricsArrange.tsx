import { useState } from 'react'
import type { Caption } from './lib/captions'
import type { ClipModel } from './lib/clip.worker'
import { clipCall, photoVectors } from './lib/clipClient'
import { schedule } from './lib/render'
import { storyboard } from './lib/storyboard'
import type { Clip, Photo, Project, Track } from './lib/types'

interface Props {
  project: Project
  photos: Map<string, Photo>
  captions: Caption[]
  track: Track | null
  setClips: (clips: Clip[]) => void
}

const HEBREW = /[֐-׿]/
const isEnglish = (s: string) => /[a-z]/i.test(s) && !HEBREW.test(s)

/** The text to match each line on: English where available (small model), otherwise whatever the line has. */
function lineTexts(captions: Caption[], model: ClipModel): (string | null)[] {
  return captions.map((c) => {
    const options = [c.text, c.translation].map((s) => s.trim()).filter(Boolean)
    if (model === 'clip') return options.find(isEnglish) ?? null
    return options[0] ?? null
  })
}

export default function LyricsArrange({ project, photos, captions, track, setClips }: Props) {
  const [choice, setChoice] = useState<'auto' | ClipModel>('auto')
  const [status, setStatus] = useState<{ busy: boolean; message: string } | null>(null)
  const [undo, setUndo] = useState<Clip[] | null>(null)

  const timed = captions.filter((c) => c.end > 0)
  const canRun = timed.length > 0 && project.clips.length > 1

  const onStatus = (message: string) => setStatus({ busy: true, message })

  async function arrange() {
    // Auto: the small English model when every sung line has English text, otherwise the multilingual one.
    const model: ClipModel =
      choice !== 'auto' ? choice : timed.every((c) => isEnglish(c.text) || isEnglish(c.translation)) ? 'clip' : 'jina'
    try {
      setStatus({ busy: true, message: 'קורא את מילות השיר…' })
      const texts = lineTexts(captions, model)
      const unique = [...new Set(texts.filter((t): t is string => !!t))]
      if (!unique.length) {
        setStatus({ busy: false, message: 'לא מצאתי שורות באנגלית. בחר במודל "רב-לשוני" כדי להתאים לפי מילים בעברית.' })
        return
      }
      const textVecs = await clipCall({ kind: 'texts', model, texts: unique }, onStatus)
      const byText = new Map(unique.map((t, i) => [t, textVecs[i]]))
      const lineVecs = texts.map((t) => (t ? byText.get(t)! : null))

      const clipPhotos = project.clips.map((c) => photos.get(c.photoId)!)
      const photoVecs = await photoVectors(clipPhotos, model, onStatus)

      const slots = schedule(project, photos, track?.beats)
      const { order, lines } = storyboard(slots, captions, photoVecs, lineVecs, clipPhotos.map((p) => p.takenAt))
      setUndo(project.clips)
      setClips(
        order.map((photoIdx, slot) => {
          const li = lines[slot]
          const c = captions[li]
          return { ...project.clips[photoIdx], lyric: c ? c.translation || c.text : undefined }
        }),
      )
      const sung = lines.filter((l) => l >= 0).length
      setStatus({
        busy: false,
        message: `סידרתי ${order.length} תמונות: ${sung} הותאמו לשורות בשיר${
          sung < order.length ? `, ו-${order.length - sung} בקטעים בלי שירה סודרו לפי תאריך` : ''
        }. השורה שכל תמונה הותאמה לה מופיעה מתחתיה בציר.`,
      })
    } catch (err) {
      setStatus({ busy: false, message: `ההתאמה נכשלה: ${err instanceof Error ? err.message : err}` })
    }
  }

  return (
    <div className="arrange">
      <div className="row">
        <button disabled={!canRun || status?.busy} onClick={arrange}>
          🎵 סדר לפי מילות השיר
        </button>
        <label>
          מודל{' '}
          <select id="arrange-model" value={choice} onChange={(e) => setChoice(e.target.value as typeof choice)}>
            <option value="auto">אוטומטי</option>
            <option value="clip">מהיר, לפי מילים באנגלית (כ-150MB)</option>
            <option value="jina">רב-לשוני, כולל עברית (כ-500MB, איטי)</option>
          </select>
        </label>
        {undo && !status?.busy && (
          <button
            className="secondary"
            onClick={() => {
              setClips(undo)
              setUndo(null)
              setStatus(null)
            }}
          >
            בטל סידור
          </button>
        )}
      </div>
      {!canRun && (
        <p className="hint">
          כדי לסדר לפי המילים צריך כתוביות מסונכרנות (שלב 6) ולפחות שתי תמונות בציר. כל תמונה תשובץ בזמן שבו
          נשמעת השורה שהכי מתאימה לה.
        </p>
      )}
      {status && <div className={`status ${status.busy ? '' : 'done'}`}>{status.message}</div>}
    </div>
  )
}
