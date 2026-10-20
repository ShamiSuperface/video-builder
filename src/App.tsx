import { useMemo, useRef, useState } from 'react'
import './App.css'
import type { Clip, FilterName, Photo, Project, Track, Transition } from './lib/types'
import { loadPhotos, sortByDate } from './lib/photos'
import { bestDistance, describeFaces, loadModels, referenceDescriptor } from './lib/faces'
import { detectBeats, mixToMono } from './lib/beats'
import { FILTERS } from './lib/render'
import Player from './Player'

const FORMATS = {
  landscape: { label: 'רוחבי 16:9', width: 1280, height: 720 },
  portrait: { label: 'אנכי 9:16 (רילס)', width: 720, height: 1280 },
  square: { label: 'ריבוע 1:1', width: 1080, height: 1080 },
} as const

const dateFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' })

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState<string>('')
  const [refs, setRefs] = useState<{ url: string; descriptor: Float32Array }[]>([])
  const [threshold, setThreshold] = useState(0.5)
  const [onlyMatches, setOnlyMatches] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [track, setTrack] = useState<Track | null>(null)
  const [format, setFormat] = useState<keyof typeof FORMATS>('landscape')
  const [project, setProject] = useState<Omit<Project, 'width' | 'height'>>({
    clips: [],
    defaultDuration: 2.5,
    transition: 'crossfade',
    transitionDuration: 0.4,
    beatsPerCut: 2,
  })
  const dragFrom = useRef<number | null>(null)

  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])
  const scanned = photos.some((p) => p.faceDistance !== undefined)
  const isMatch = (p: Photo) => p.faceDistance !== undefined && p.faceDistance <= threshold
  const visible = onlyMatches && scanned ? photos.filter(isMatch) : photos
  const fullProject: Project = { ...project, ...FORMATS[format] }

  async function onFolder(files: FileList | null) {
    if (!files?.length) return
    setLoading('קורא תמונות…')
    const loaded = await loadPhotos(files, (d, t) => setLoading(`קורא תאריכי צילום ${d}/${t}`))
    setPhotos((prev) => {
      const seen = new Set(prev.map((p) => p.id))
      return sortByDate([...prev, ...loaded.filter((p) => !seen.has(p.id))])
    })
    setLoading('')
  }

  async function onReferences(files: FileList | null) {
    if (!files?.length) return
    setLoading('טוען מודל זיהוי פנים…')
    await loadModels()
    const added: typeof refs = []
    let missing = 0
    for (const f of files) {
      const url = URL.createObjectURL(f)
      const d = await referenceDescriptor(url)
      if (d) added.push({ url, descriptor: d })
      else missing++
    }
    setRefs((r) => [...r, ...added])
    setLoading(missing ? `לא נמצאו פנים ב-${missing} תמונות רפרנס` : '')
  }

  async function useAsReference(p: Photo) {
    setLoading('מחפש פנים בתמונה…')
    const d = await referenceDescriptor(p.url)
    if (d) setRefs((r) => [...r, { url: p.url, descriptor: d }])
    setLoading(d ? '' : 'לא נמצאו פנים בתמונה הזו')
  }

  async function scanFaces() {
    if (!refs.length) return
    setLoading('טוען מודל זיהוי פנים…')
    await loadModels()
    const descriptors = refs.map((r) => r.descriptor)
    const results = new Map<string, { faceDistance: number; faceCount: number }>()
    for (let i = 0; i < photos.length; i++) {
      setLoading(`סורק פנים ${i + 1}/${photos.length}`)
      try {
        const faces = await describeFaces(photos[i].url)
        results.set(photos[i].id, { faceDistance: bestDistance(faces, descriptors), faceCount: faces.length })
      } catch {
        results.set(photos[i].id, { faceDistance: Infinity, faceCount: 0 })
      }
    }
    setPhotos((prev) => prev.map((p) => ({ ...p, ...results.get(p.id) })))
    setOnlyMatches(true)
    setLoading('')
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function addToTimeline(ids: string[]) {
    const ordered = sortByDate(ids.map((id) => photoMap.get(id)!).filter(Boolean))
    const clips: Clip[] = ordered.map((p) => ({ photoId: p.id, filter: 'none', kenBurns: true }))
    setProject((pr) => ({ ...pr, clips: [...pr.clips, ...clips] }))
    setSelected(new Set())
  }

  function updateClip(i: number, patch: Partial<Clip>) {
    setProject((pr) => ({ ...pr, clips: pr.clips.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  }

  function moveClip(from: number, to: number) {
    setProject((pr) => {
      const clips = [...pr.clips]
      const [c] = clips.splice(from, 1)
      clips.splice(to, 0, c)
      return { ...pr, clips }
    })
  }

  function sortTimelineByDate() {
    setProject((pr) => ({
      ...pr,
      clips: [...pr.clips].sort(
        (a, b) => (photoMap.get(a.photoId)?.takenAt ?? 0) - (photoMap.get(b.photoId)?.takenAt ?? 0),
      ),
    }))
  }

  async function onMusic(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setLoading('מנתח ביטים במוזיקה…')
    const ctx = new AudioContext()
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    await ctx.close()
    // Let the status paint before the CPU-heavy analysis.
    await new Promise((r) => setTimeout(r, 30))
    const { beats, bpm } = detectBeats(mixToMono(buffer), buffer.sampleRate)
    setTrack({ file, url: URL.createObjectURL(file), buffer, beats, bpm })
    setLoading('')
  }

  const matchCount = photos.filter(isMatch).length

  return (
    <div className="app" dir="rtl">
      <header>
        <h1>בונה סרטונים</h1>
        {loading && <div className="status">{loading}</div>}
      </header>

      <section>
        <h2>1. תמונות</h2>
        <div className="row">
          <label className="btn">
            בחירת תיקייה
            <input
              type="file"
              multiple
              hidden
              {...{ webkitdirectory: '', directory: '' }}
              onChange={(e) => onFolder(e.target.files)}
            />
          </label>
          <label className="btn secondary">
            או קבצים בודדים
            <input type="file" accept="image/*" multiple hidden onChange={(e) => onFolder(e.target.files)} />
          </label>
          <span>{photos.length} תמונות, ממוינות לפי תאריך צילום</span>
        </div>
      </section>

      <section>
        <h2>2. זיהוי פנים</h2>
        <p className="hint">
          העלה 1-3 תמונות ברורות של האדם שאתה מחפש, או לחץ "רפרנס" על תמונה בגלריה. הכל רץ אצלך בדפדפן.
        </p>
        <div className="row">
          <label className="btn secondary">
            העלאת תמונות רפרנס
            <input type="file" accept="image/*" multiple hidden onChange={(e) => onReferences(e.target.files)} />
          </label>
          <div className="refs">
            {refs.map((r, i) => (
              <img key={i} src={r.url} title="לחץ להסרה" onClick={() => setRefs((x) => x.filter((_, j) => j !== i))} />
            ))}
          </div>
          <button disabled={!refs.length || !photos.length || !!loading} onClick={scanFaces}>
            סרוק את כל התמונות
          </button>
        </div>
        {scanned && (
          <div className="row">
            <label>
              רגישות התאמה {threshold.toFixed(2)}
              <input
                type="range"
                min={0.35}
                max={0.7}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(+e.target.value)}
              />
            </label>
            <span>נמצאו {matchCount} תמונות תואמות</span>
            <label>
              <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} /> הצג
              רק תואמות
            </label>
            <button onClick={() => addToTimeline(photos.filter(isMatch).map((p) => p.id))} disabled={!matchCount}>
              הוסף את כל התואמות לסרטון
            </button>
          </div>
        )}
      </section>

      <section>
        <h2>3. גלריה</h2>
        <div className="row">
          <button disabled={!selected.size} onClick={() => addToTimeline([...selected])}>
            הוסף {selected.size || ''} נבחרות לסרטון
          </button>
          <button className="secondary" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>
            בחר הכל
          </button>
        </div>
        <div className="grid">
          {visible.map((p) => (
            <figure key={p.id} className={selected.has(p.id) ? 'sel' : ''} onClick={() => toggle(p.id)}>
              <img src={p.url} loading="lazy" />
              <figcaption>
                {dateFmt.format(p.takenAt)}
                {!p.hasExifDate && ' *'}
                {p.faceDistance !== undefined && isFinite(p.faceDistance) && (
                  <span className={isMatch(p) ? 'match' : ''}> · {(1 - p.faceDistance).toFixed(2)}</span>
                )}
              </figcaption>
              <button
                className="mini"
                onClick={(e) => {
                  e.stopPropagation()
                  useAsReference(p)
                }}
              >
                רפרנס
              </button>
            </figure>
          ))}
        </div>
      </section>

      <section>
        <h2>4. ציר זמן ועריכה</h2>
        <div className="row">
          <button className="secondary" onClick={sortTimelineByDate}>
            מיין לפי תאריך
          </button>
          <label>
            פילטר לכולן{' '}
            <select
              onChange={(e) =>
                setProject((pr) => ({
                  ...pr,
                  clips: pr.clips.map((c) => ({ ...c, filter: e.target.value as FilterName })),
                }))
              }
              defaultValue=""
            >
              <option value="" disabled>
                בחר…
              </option>
              {Object.entries(FILTERS).map(([k, f]) => (
                <option key={k} value={k}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            מעבר{' '}
            <select
              value={project.transition}
              onChange={(e) => setProject((pr) => ({ ...pr, transition: e.target.value as Transition }))}
            >
              <option value="cut">חיתוך</option>
              <option value="crossfade">מעבר רך</option>
              <option value="fadeBlack">דעיכה לשחור</option>
            </select>
          </label>
          {!track && (
            <label>
              שניות לתמונה{' '}
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={project.defaultDuration}
                onChange={(e) => setProject((pr) => ({ ...pr, defaultDuration: Math.max(0.5, +e.target.value) }))}
              />
            </label>
          )}
          <button className="secondary" onClick={() => setProject((pr) => ({ ...pr, clips: [] }))}>
            נקה ציר
          </button>
        </div>
        <div className="timeline">
          {project.clips.map((c, i) => {
            const p = photoMap.get(c.photoId)
            if (!p) return null
            return (
              <div
                key={`${c.photoId}-${i}`}
                className="clip"
                draggable
                onDragStart={() => (dragFrom.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom.current !== null && dragFrom.current !== i) moveClip(dragFrom.current, i)
                  dragFrom.current = null
                }}
              >
                <img src={p.url} style={{ filter: FILTERS[c.filter].css }} />
                <select value={c.filter} onChange={(e) => updateClip(i, { filter: e.target.value as FilterName })}>
                  {Object.entries(FILTERS).map(([k, f]) => (
                    <option key={k} value={k}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={c.kenBurns}
                    onChange={(e) => updateClip(i, { kenBurns: e.target.checked })}
                  />{' '}
                  זום
                </label>
                <button
                  className="mini"
                  onClick={() => setProject((pr) => ({ ...pr, clips: pr.clips.filter((_, j) => j !== i) }))}
                >
                  ✕
                </button>
              </div>
            )
          })}
          {!project.clips.length && <p className="hint">הוסף תמונות מהגלריה. אפשר לגרור כדי לשנות סדר.</p>}
        </div>
      </section>

      <section>
        <h2>5. מוזיקה</h2>
        <div className="row">
          <label className="btn secondary">
            העלאת שיר
            <input type="file" accept="audio/*" hidden onChange={(e) => onMusic(e.target.files)} />
          </label>
          {track && (
            <>
              <span>
                {track.file.name} · {track.bpm} BPM · {track.beats.length} ביטים
              </span>
              <label>
                חיתוך כל{' '}
                <select
                  value={project.beatsPerCut}
                  onChange={(e) => setProject((pr) => ({ ...pr, beatsPerCut: +e.target.value }))}
                >
                  {[1, 2, 4, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} ביטים
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary" onClick={() => setTrack(null)}>
                הסר מוזיקה
              </button>
            </>
          )}
        </div>
      </section>

      <section>
        <h2>6. תצוגה מקדימה וייצוא</h2>
        <div className="row">
          <label>
            פורמט{' '}
            <select value={format} onChange={(e) => setFormat(e.target.value as keyof typeof FORMATS)}>
              {Object.entries(FORMATS).map(([k, f]) => (
                <option key={k} value={k}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Player project={fullProject} photos={photoMap} track={track} />
      </section>
    </div>
  )
}
