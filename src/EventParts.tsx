import { useRef, useState } from 'react'
import { clipCall, photoVectors } from './lib/clipClient'
import { autoPartCount, meanVec, nameParts, PART_LABELS, segment } from './lib/parts'
import { sortByDate } from './lib/photos'
import type { EventPart, Photo } from './lib/types'

interface Props {
  /** Photos to split: the ones shown in the gallery. */
  source: Photo[]
  photos: Map<string, Photo>
  parts: EventPart[]
  setParts: (parts: EventPart[]) => void
  partTitles: boolean
  setPartTitles: (on: boolean) => void
  onSelect: (ids: string[]) => void
  onAdd: (parts: EventPart[]) => void
  onArrangeTimeline: () => void
  timelineCount: number
}

const timeFmt = new Intl.DateTimeFormat('he-IL', { timeStyle: 'short' })
const dayFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short' })

export default function EventParts(props: Props) {
  const { source, photos, parts, setParts } = props
  const [count, setCount] = useState(0) // 0 = automatic
  const [status, setStatus] = useState<{ busy: boolean; message: string } | null>(null)
  // Vectors from the last analysis, so changing the number of parts needs no model.
  const analysed = useRef<{ ids: string[]; vecs: Float32Array[] | null; labels: Float32Array[] | null } | null>(null)

  function build(sorted: Photo[], vecs: Float32Array[] | null, labels: Float32Array[] | null, k: number) {
    const starts = segment(
      sorted.map((p, i) => ({ takenAt: p.takenAt, vec: vecs?.[i] })),
      k,
    )
    const ranges = starts.map((s, i) => [s, starts[i + 1] ?? sorted.length] as const)
    const names = nameParts(
      ranges.map(([a, b]) => (vecs ? meanVec(vecs.slice(a, b)) : null)),
      labels,
    )
    setParts(
      ranges.map(([a, b], i) => ({ id: crypto.randomUUID(), name: names[i], photoIds: sorted.slice(a, b).map((p) => p.id) })),
    )
  }

  async function detect() {
    const sorted = sortByDate(source)
    if (sorted.length < 2) return
    const k = count || autoPartCount(sorted.length)
    const onStatus = (message: string) => setStatus({ busy: true, message })
    let vecs: Float32Array[] | null = null
    let labels: Float32Array[] | null = null
    let note = ''
    try {
      onStatus('מנתח את התמונות…')
      vecs = await photoVectors(sorted, 'clip', onStatus)
      labels = await clipCall({ kind: 'texts', model: 'clip', texts: PART_LABELS.map((l) => l.prompt) }, onStatus)
    } catch (err) {
      vecs = labels = null
      note = ` ניתוח התמונות לא הצליח (${err instanceof Error ? err.message : err}), אז החלוקה לפי זמני הצילום בלבד.`
    }
    analysed.current = { ids: sorted.map((p) => p.id), vecs, labels }
    build(sorted, vecs, labels, k)
    setStatus({ busy: false, message: `חילקתי ${sorted.length} תמונות ל-${Math.min(k, sorted.length)} חלקים.${note}` })
  }

  function recount(k: number) {
    setCount(k)
    const a = analysed.current
    if (!a || !parts.length) return
    const sorted = a.ids.map((id) => photos.get(id)).filter((p): p is Photo => !!p)
    if (sorted.length !== a.ids.length) return
    build(sorted, a.vecs, a.labels, k || autoPartCount(sorted.length))
  }

  const rename = (id: string, name: string) => setParts(parts.map((p) => (p.id === id ? { ...p, name } : p)))
  const n = analysed.current?.ids.length ?? source.length

  return (
    <div className="event-parts">
      <div className="row">
        <button disabled={source.length < 2 || status?.busy} onClick={detect}>
          🧩 זהה חלקים באירוע
        </button>
        <label>
          מספר חלקים{' '}
          <select id="part-count" value={count} onChange={(e) => recount(+e.target.value)}>
            <option value={0}>אוטומטי ({autoPartCount(n)})</option>
            {Array.from({ length: Math.min(12, Math.max(0, n - 1)) }, (_, i) => i + 2).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {parts.length > 0 && (
          <>
            <button onClick={() => props.onAdd(parts)}>הוסף את כל החלקים לסרטון</button>
            <button className="secondary" disabled={!props.timelineCount} onClick={props.onArrangeTimeline}>
              סדר את ציר הזמן לפי החלקים
            </button>
            <label>
              <input type="checkbox" checked={props.partTitles} onChange={(e) => props.setPartTitles(e.target.checked)} />{' '}
              הצג את שם החלק בסרטון
            </label>
            <button className="secondary" onClick={() => setParts([])}>
              נקה חלקים
            </button>
          </>
        )}
      </div>
      {!parts.length && (
        <p className="hint">
          המערכת מקבצת את התמונות שבגלריה לחלקים של האירוע לפי זמני הצילום ולפי מה שרואים בתמונות (הפסקות ארוכות
          ושינויי סצנה הופכים לגבול בין חלקים), ומציעה שם לכל חלק. אפשר לשנות שמות ומספר חלקים.
        </p>
      )}
      {status && <div className={`status ${status.busy ? '' : 'done'}`}>{status.message}</div>}
      <div className="parts">
        {parts.map((part, i) => {
          const ps = part.photoIds.map((id) => photos.get(id)).filter((p): p is Photo => !!p)
          if (!ps.length) return null
          const from = ps[0].takenAt
          const to = ps[ps.length - 1].takenAt
          return (
            <div key={part.id} className="part">
              <div className="row">
                <span className="part-num">{i + 1}</span>
                <input
                  className="part-name"
                  value={part.name}
                  onChange={(e) => rename(part.id, e.target.value)}
                  aria-label={`שם חלק ${i + 1}`}
                />
                <span className="hint">
                  {ps.length} תמונות · {dayFmt.format(from)} {timeFmt.format(from)}
                  {to - from > 60e3 && `–${timeFmt.format(to)}`}
                </span>
                <button className="mini secondary" onClick={() => props.onSelect(part.photoIds)}>
                  בחר בגלריה
                </button>
                <button className="mini" onClick={() => props.onAdd([part])}>
                  הוסף לסרטון
                </button>
              </div>
              <div className="part-thumbs">
                {ps.slice(0, 10).map((p) => (
                  <img key={p.id} src={p.url} loading="lazy" />
                ))}
                {ps.length > 10 && <span className="more">+{ps.length - 10}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
