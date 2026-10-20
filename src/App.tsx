import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { Clip, FilterName, MatchMode, Person, Photo, Project, Track, Transition } from './lib/types'
import { loadPhotos, sortByDate } from './lib/photos'
import { describeFaces, loadModels, matchPeople, referenceDescriptor } from './lib/faces'
import { detectBeats, mixToMono } from './lib/beats'
import { FILTERS } from './lib/render'
import Player from './Player'
import Captions from './Captions'
import { DEFAULT_CAPTION_STYLE, type Caption, type CaptionStyle } from './lib/captions'
import Drafts from './Drafts'
import { loadDraft, makeThumb, saveDraft, type DraftData } from './lib/drafts'

const FORMATS = {
  landscape: { label: 'רוחבי 16:9', width: 1280, height: 720 },
  portrait: { label: 'אנכי 9:16 (רילס)', width: 720, height: 1280 },
  square: { label: 'ריבוע 1:1', width: 1080, height: 1080 },
} as const

const dateFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' })

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState<string>('')
  const [people, setPeople] = useState<Person[]>([])
  const [activePerson, setActivePerson] = useState<string>('')
  const [matchMode, setMatchMode] = useState<MatchMode>('any')
  const [threshold, setThreshold] = useState(0.5)
  const [onlyMatches, setOnlyMatches] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [track, setTrack] = useState<Track | null>(null)
  const [captions, setCaptions] = useState<Caption[]>([])
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE)
  const [format, setFormat] = useState<keyof typeof FORMATS>('landscape')
  const [project, setProject] = useState<Omit<Project, 'width' | 'height'>>({
    clips: [],
    defaultDuration: 2.5,
    transition: 'crossfade',
    transitionDuration: 0.4,
    beatsPerCut: 2,
  })
  const dragFrom = useRef<number | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('סרטון חדש')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [draftsVersion, setDraftsVersion] = useState(0)

  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])
  const withRefs = useMemo(() => people.filter((p) => p.refs.length), [people])
  const scanned = photos.some((p) => p.faces !== undefined)
  // Re-matching is cheap: descriptors are stored per photo, so changing people or threshold needs no rescan.
  const matches = useMemo(
    () => new Map(photos.map((p) => [p.id, p.faces ? matchPeople(p.faces, withRefs, threshold) : new Map()])),
    [photos, withRefs, threshold],
  )
  const isMatch = (p: Photo) => {
    const m = matches.get(p.id)
    if (!m || !withRefs.length) return false
    return matchMode === 'all' ? withRefs.every((x) => m.has(x.id)) : m.size > 0
  }
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

  function addPerson() {
    const id = crypto.randomUUID()
    setPeople((ps) => [...ps, { id, name: `אדם ${ps.length + 1}`, refs: [] }])
    setActivePerson(id)
    return id
  }

  function addRef(ref: Person['refs'][number]) {
    setPeople((ps) => {
      // A reference with no person yet starts the first one.
      if (!ps.length) {
        const id = crypto.randomUUID()
        setActivePerson(id)
        return [{ id, name: 'אדם 1', refs: [ref] }]
      }
      const target = ps.some((p) => p.id === activePerson) ? activePerson : ps[ps.length - 1].id
      return ps.map((p) => (p.id === target ? { ...p, refs: [...p.refs, ref] } : p))
    })
  }

  async function onReferences(files: FileList | null) {
    if (!files?.length) return
    setLoading('טוען מודל זיהוי פנים…')
    await loadModels()
    let missing = 0
    for (const f of files) {
      const url = URL.createObjectURL(f)
      const d = await referenceDescriptor(url)
      if (d) addRef({ url, blob: f, descriptor: d })
      else missing++
    }
    setLoading(missing ? `לא נמצאו פנים ב-${missing} תמונות רפרנס` : '')
  }

  async function useAsReference(p: Photo) {
    setLoading('מחפש פנים בתמונה…')
    const d = await referenceDescriptor(p.url)
    if (d) addRef({ url: p.url, blob: p.file, descriptor: d })
    setLoading(d ? '' : 'לא נמצאו פנים בתמונה הזו')
  }

  async function scanFaces() {
    setLoading('טוען מודל זיהוי פנים…')
    await loadModels()
    const results = new Map<string, Float32Array[]>()
    const todo = photos.filter((p) => !p.faces)
    for (let i = 0; i < todo.length; i++) {
      setLoading(`סורק פנים ${i + 1}/${todo.length}`)
      try {
        results.set(todo[i].id, await describeFaces(todo[i].url))
      } catch {
        results.set(todo[i].id, [])
      }
    }
    setPhotos((prev) => prev.map((p) => (results.has(p.id) ? { ...p, faces: results.get(p.id) } : p)))
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

  const draftData = (): DraftData => ({
    photos: photos.map(({ id, file, path, takenAt, hasExifDate, faces }) => ({ id, file, path, takenAt, hasExifDate, faces })),
    people: people.map(({ id, name, refs }) => ({ id, name, refs: refs.map(({ blob, descriptor }) => ({ blob, descriptor })) })),
    matchMode,
    threshold,
    project,
    format,
    track: track && { file: track.file, beats: track.beats, bpm: track.bpm },
    captions,
    captionStyle,
  })

  const saveNow = useCallback(async () => {
    const id = draftId ?? crypto.randomUUID()
    const first = photoMap.get(project.clips[0]?.photoId ?? '') ?? photos[0]
    await saveDraft({
      id,
      name: draftName.trim() || 'ללא שם',
      updatedAt: Date.now(),
      thumb: first ? await makeThumb(first.file) : undefined,
      data: draftData(),
    })
    setDraftId(id)
    setSavedAt(Date.now())
    setDraftsVersion((v) => v + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draftName, photos, people, matchMode, threshold, project, format, track, captions, captionStyle])

  // Once a draft exists, keep it saved: a couple of seconds after the last change.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (!draftId) return
    const t = setTimeout(() => saveNow().catch(() => setLoading('השמירה האוטומטית נכשלה')), 2000)
    return () => clearTimeout(t)
    // Autosave on content changes only; saveNow itself changes with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftName, photos, people, matchMode, threshold, project, format, track, captions, captionStyle])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveNow])

  async function openDraft(id: string) {
    setLoading('פותח טיוטה…')
    const d = await loadDraft(id)
    if (!d) return setLoading('הטיוטה לא נמצאה')
    const { data } = d
    const restored: Photo[] = data.photos.map((p) => ({ ...p, name: p.file.name, url: URL.createObjectURL(p.file) }))
    let restoredTrack: Track | null = null
    if (data.track) {
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(await data.track.file.arrayBuffer())
      await ctx.close()
      restoredTrack = { ...data.track, url: URL.createObjectURL(data.track.file), buffer }
    }
    // Skip one autosave: loading a draft is not an edit.
    firstRender.current = true
    setPhotos(restored)
    setPeople(
      data.people.map((p) => ({ ...p, refs: p.refs.map((r) => ({ ...r, url: URL.createObjectURL(r.blob) })) })),
    )
    setActivePerson(data.people[0]?.id ?? '')
    setMatchMode(data.matchMode)
    setThreshold(data.threshold)
    setOnlyMatches(false)
    setSelected(new Set())
    setProject(data.project)
    setFormat((data.format in FORMATS ? data.format : 'landscape') as keyof typeof FORMATS)
    setTrack(restoredTrack)
    setCaptions(data.captions)
    setCaptionStyle(data.captionStyle)
    setDraftId(d.id)
    setDraftName(d.name)
    setSavedAt(d.updatedAt)
    setLoading('')
  }

  function newDraft() {
    if (!draftId && (photos.length || captions.length) && !confirm('לפתוח סרטון חדש? העבודה הנוכחית לא נשמרה.')) return
    location.reload()
  }

  const timeFmt = new Intl.DateTimeFormat('he-IL', { timeStyle: 'short' })

  return (
    <div className="app" dir="rtl">
      <header>
        <h1>בונה סרטונים</h1>
        <input
          id="draft-name"
          className="draft-name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          aria-label="שם הסרטון"
        />
        <button onClick={() => saveNow()} title="Ctrl+S">
          {draftId ? 'שמור' : 'שמור טיוטה'}
        </button>
        {savedAt && <span className="saved">נשמר {timeFmt.format(savedAt)} · נשמר אוטומטית</span>}
        <button className="secondary" onClick={newDraft}>
          חדש
        </button>
        {loading && <div className="status">{loading}</div>}
      </header>
      <Drafts version={draftsVersion} currentId={draftId} onOpen={openDraft} onDeleted={(id) => id === draftId && setDraftId(null)} />

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
          הוסף כל אדם שצריך להופיע בסרטון, עם 1-3 תמונות ברורות שלו. אפשר להעלות תמונות או ללחוץ "רפרנס" על תמונה
          בגלריה, והיא תתווסף לאדם המסומן. הכל רץ אצלך בדפדפן.
        </p>
        <div className="people">
          {people.map((person) => (
            <div
              key={person.id}
              className={`person ${person.id === activePerson ? 'active' : ''}`}
              onClick={() => setActivePerson(person.id)}
            >
              <input
                id={`person-${person.id}`}
                value={person.name}
                onChange={(e) =>
                  setPeople((ps) => ps.map((p) => (p.id === person.id ? { ...p, name: e.target.value } : p)))
                }
              />
              <div className="refs">
                {person.refs.map((r, i) => (
                  <img
                    key={i}
                    src={r.url}
                    title="לחץ להסרה"
                    onClick={() =>
                      setPeople((ps) =>
                        ps.map((p) => (p.id === person.id ? { ...p, refs: p.refs.filter((_, j) => j !== i) } : p)),
                      )
                    }
                  />
                ))}
                {!person.refs.length && <span className="hint">אין עדיין תמונות</span>}
              </div>
              <div className="row">
                <label className="btn secondary mini" onClick={() => setActivePerson(person.id)}>
                  + תמונות
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => onReferences(e.target.files)} />
                </label>
                <button
                  className="mini secondary"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPeople((ps) => ps.filter((p) => p.id !== person.id))
                  }}
                >
                  הסר
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="row">
          <button className="secondary" onClick={addPerson}>
            + הוסף אדם
          </button>
          {!people.length && (
            <label className="btn secondary">
              העלאת תמונות רפרנס
              <input type="file" accept="image/*" multiple hidden onChange={(e) => onReferences(e.target.files)} />
            </label>
          )}
          <button disabled={!withRefs.length || !photos.length || !!loading} onClick={scanFaces}>
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
            {withRefs.length > 1 && (
              <label>
                הצג תמונות עם{' '}
                <select value={matchMode} onChange={(e) => setMatchMode(e.target.value as MatchMode)}>
                  <option value="any">לפחות אחד מהם</option>
                  <option value="all">כולם יחד</option>
                </select>
              </label>
            )}
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
                {!!matches.get(p.id)?.size && (
                  <span className={isMatch(p) ? 'match' : ''}>
                    {' · '}
                    {withRefs
                      .filter((x) => matches.get(p.id)!.has(x.id))
                      .map((x) => x.name)
                      .join(', ')}
                  </span>
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
        <h2>6. כתוביות</h2>
        <Captions
          captions={captions}
          setCaptions={setCaptions}
          style={captionStyle}
          setStyle={setCaptionStyle}
          track={track}
        />
      </section>

      <section>
        <h2>7. תצוגה מקדימה וייצוא</h2>
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
        <Player project={fullProject} photos={photoMap} track={track} captions={captions} captionStyle={captionStyle} />
      </section>
    </div>
  )
}
