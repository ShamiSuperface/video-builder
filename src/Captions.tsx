import { useEffect, useRef, useState } from 'react'
import type { Track } from './lib/types'
import {
  applyTranslation,
  fillEnds,
  fromLines,
  parseLrc,
  parseSrt,
  snapToBeats,
  toSrt,
  type Caption,
  type CaptionPosition,
  type CaptionShow,
  type CaptionStyle,
} from './lib/captions'

interface Props {
  captions: Caption[]
  setCaptions: (c: Caption[]) => void
  style: CaptionStyle
  setStyle: (s: CaptionStyle) => void
  track: Track | null
}

export default function Captions({ captions, setCaptions, style, setStyle, track }: Props) {
  const [original, setOriginal] = useState('')
  const [translation, setTranslation] = useState('')
  const [syncIndex, setSyncIndex] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const latest = useRef({ captions, syncIndex })
  latest.current = { captions, syncIndex }

  const timed = captions.some((c) => c.end > 0)

  function createLines() {
    setCaptions(fromLines(original, translation))
  }

  async function onFile(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    const text = await f.text()
    const parsed = /\.srt$/i.test(f.name) || text.includes('-->') ? parseSrt(text) : parseLrc(text)
    setCaptions(parsed)
    setOriginal(parsed.map((c) => c.text).join('\n'))
    setTranslation(parsed.map((c) => c.translation).join('\n'))
  }

  function startSync() {
    const a = audioRef.current
    if (!a || !captions.length) return
    setCaptions(captions.map((c) => ({ ...c, start: 0, end: 0 })))
    setSyncIndex(0)
    a.currentTime = 0
    a.play()
  }

  function finishSync() {
    const { captions: cs, syncIndex: n } = latest.current
    const a = audioRef.current
    if (n === null) return
    // Lines tapped so far get timing; the line still showing ends now. Untapped lines stay untimed.
    const synced = cs.slice(0, n).map((c, i) => (i === n - 1 && a ? { ...c, end: a.currentTime } : c))
    setCaptions([...fillEnds(synced), ...cs.slice(n)])
    setSyncIndex(null)
    a?.pause()
  }

  function tap() {
    const { captions: cs, syncIndex: i } = latest.current
    const a = audioRef.current
    if (i === null || !a) return
    if (i >= cs.length) return finishSync()
    setCaptions(cs.map((c, j) => (j === i ? { ...c, start: a.currentTime } : c)))
    setSyncIndex(i + 1)
  }

  useEffect(() => {
    if (syncIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        tap()
      } else if (e.code === 'Escape') finishSync()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // tap/finishSync read the latest state through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncIndex])

  function update(i: number, patch: Partial<Caption>) {
    setCaptions(captions.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }

  function shiftAll(dt: number) {
    setCaptions(captions.map((c) => ({ ...c, start: Math.max(0, c.start + dt), end: Math.max(0, c.end + dt) })))
  }

  function playFrom(t: number) {
    const a = audioRef.current
    if (!a) return
    a.currentTime = t
    a.play()
  }

  function downloadSrt() {
    const url = URL.createObjectURL(new Blob([toSrt(captions)], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'captions.srt'
    a.click()
  }

  const syncing = syncIndex !== null

  return (
    <div className="captions">
      <p className="hint">
        מדביקים את מילות השיר, ואם רוצים גם תרגום, שורה מול שורה. אחר כך מסנכרנים בהקשה: מנגנים את השיר ולוחצים
        רווח בתחילת כל שורה. התרגום מקבל את אותו תזמון כמו השורה המקורית. אפשר גם לייבא קובץ LRC או SRT מוכן.
      </p>
      <div className="lyrics">
        <label>
          מילים במקור
          <textarea
            id="lyrics-original"
            rows={6}
            dir="auto"
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
            placeholder={'Here comes the sun\nLittle darling…'}
          />
        </label>
        <label>
          תרגום (לא חובה)
          <textarea
            id="lyrics-translation"
            rows={6}
            dir="auto"
            value={translation}
            onChange={(e) => setTranslation(e.target.value)}
            placeholder={'הנה באה השמש\nיקירתי הקטנה…'}
          />
        </label>
      </div>
      <div className="row">
        <button disabled={!original.trim() && !translation.trim()} onClick={createLines}>
          צור שורות כתוביות
        </button>
        {timed && (
          <button className="secondary" onClick={() => setCaptions(applyTranslation(captions, translation))}>
            עדכן תרגום בלי לשנות תזמון
          </button>
        )}
        <label className="btn secondary">
          ייבוא LRC / SRT
          <input type="file" accept=".lrc,.srt,text/plain" hidden onChange={(e) => onFile(e.target.files)} />
        </label>
      </div>

      {captions.length > 0 && (
        <>
          {track ? (
            <div className="row sync">
              <audio
                ref={audioRef}
                src={track.url}
                controls
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                onEnded={() => syncing && finishSync()}
              />
              {!syncing ? (
                <button onClick={startSync}>סנכרון בהקשה</button>
              ) : (
                <>
                  <button className="tap" onClick={tap}>
                    {syncIndex! < captions.length
                      ? `שורה ${syncIndex! + 1}/${captions.length} (רווח)`
                      : 'סיום השורה האחרונה (רווח)'}
                  </button>
                  <button className="secondary" onClick={finishSync}>
                    סיום (Esc)
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="hint">כדי לסנכרן בהקשה צריך קודם להעלות שיר בשלב 5.</p>
          )}
          {syncing && syncIndex! < captions.length && (
            <div className="next-line" dir="auto">
              הבאה: {captions[syncIndex!].text || captions[syncIndex!].translation}
            </div>
          )}

          <div className="row">
            <button className="secondary" disabled={!track?.beats.length || !timed} onClick={() => setCaptions(snapToBeats(captions, track!.beats))}>
              הצמד לביטים
            </button>
            <button className="secondary" disabled={!timed} onClick={() => shiftAll(-0.1)}>
              הקדם הכל 0.1 שנ׳
            </button>
            <button className="secondary" disabled={!timed} onClick={() => shiftAll(0.1)}>
              אחר הכל 0.1 שנ׳
            </button>
            <button className="secondary" disabled={!timed} onClick={downloadSrt}>
              הורדת SRT
            </button>
            <button className="secondary" onClick={() => setCaptions([])}>
              מחק כתוביות
            </button>
          </div>

          <div className="row">
            <label>
              הצג{' '}
              <select
                id="caption-show"
                value={style.show}
                onChange={(e) => setStyle({ ...style, show: e.target.value as CaptionShow })}
              >
                <option value="both">מקור ותרגום</option>
                <option value="translation">רק תרגום</option>
                <option value="original">רק מקור</option>
              </select>
            </label>
            <label>
              מיקום{' '}
              <select
                id="caption-position"
                value={style.position}
                onChange={(e) => setStyle({ ...style, position: e.target.value as CaptionPosition })}
              >
                <option value="bottom">למטה</option>
                <option value="middle">באמצע</option>
                <option value="top">למעלה</option>
              </select>
            </label>
            <label>
              גודל{' '}
              <input
                id="caption-size"
                type="range"
                min={0.03}
                max={0.1}
                step={0.005}
                value={style.size}
                onChange={(e) => setStyle({ ...style, size: +e.target.value })}
              />
            </label>
          </div>

          <div className="caption-table">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>התחלה</th>
                  <th>סוף</th>
                  <th>מקור</th>
                  <th>תרגום</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {captions.map((c, i) => (
                  <tr key={i} className={now >= c.start && now < c.end ? 'current' : ''}>
                    <td>
                      <button className="mini secondary" disabled={!track} onClick={() => playFrom(c.start)} title="נגן מכאן">
                        ▶
                      </button>
                    </td>
                    <td>
                      <input
                        type="number"
                        step={0.05}
                        min={0}
                        value={+c.start.toFixed(2)}
                        onChange={(e) => update(i, { start: +e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step={0.05}
                        min={0}
                        value={+c.end.toFixed(2)}
                        onChange={(e) => update(i, { end: +e.target.value })}
                      />
                    </td>
                    <td>
                      <input dir="auto" value={c.text} onChange={(e) => update(i, { text: e.target.value })} />
                    </td>
                    <td>
                      <input dir="auto" value={c.translation} onChange={(e) => update(i, { translation: e.target.value })} />
                    </td>
                    <td>
                      <button className="mini secondary" onClick={() => setCaptions(captions.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
