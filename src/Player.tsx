import { useEffect, useMemo, useRef, useState } from 'react'
import type { Photo, Project, Track } from './lib/types'
import { cutEvery, drawFrame, pickRecorderMime, preload, schedule, totalDuration } from './lib/render'
import { drawCaptions, type Caption, type CaptionStyle } from './lib/captions'

interface Props {
  project: Project
  photos: Map<string, Photo>
  track: Track | null
  captions: Caption[]
  captionStyle: CaptionStyle
  /** Switches cutting to automatic so the photos last as long as the song. */
  onFitSong: () => void
}

type Mode = 'idle' | 'playing' | 'exporting'

export default function Player({ project, photos, track, captions, captionStyle, onFitSong }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [time, setTime] = useState(0)
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null)

  const sched = useMemo(() => schedule(project, photos, track?.beats), [project, photos, track])
  const duration = totalDuration(sched)
  const lateCaptions = captions.filter((c) => c.end > 0 && c.start >= duration).length

  // Show the first frame whenever the edit changes and nothing is playing.
  useEffect(() => {
    if (mode !== 'idle') return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    preload(sched).then((images) => {
      if (cancelled) return
      const ctx = canvas.getContext('2d')!
      const t = Math.min(time, duration - 0.01)
      drawFrame(ctx, sched, images, project, t)
      drawCaptions(ctx, captions, captionStyle, t)
    })
    return () => {
      cancelled = true
    }
  }, [sched, project, mode, time, duration, captions, captionStyle])

  async function run(record: boolean) {
    const canvas = canvasRef.current
    if (!canvas || !sched.length) return
    stopRef.current?.()
    setDownload(null)
    const images = await preload(sched)
    const ctx2d = canvas.getContext('2d')!
    const audio = new AudioContext()
    const dest = audio.createMediaStreamDestination()
    let source: AudioBufferSourceNode | null = null
    if (track) {
      source = audio.createBufferSource()
      source.buffer = track.buffer
      const gain = audio.createGain()
      // Fade the music out over the last second of the video.
      gain.gain.setValueAtTime(1, audio.currentTime + Math.max(0, duration - 1))
      gain.gain.linearRampToValueAtTime(0, audio.currentTime + duration)
      source.connect(gain)
      gain.connect(audio.destination)
      if (record) gain.connect(dest)
    }

    let recorder: MediaRecorder | null = null
    const chunks: Blob[] = []
    const mime = pickRecorderMime()
    if (record) {
      const stream = canvas.captureStream(30)
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mime || 'video/webm' })
        const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm'
        setDownload({ url: URL.createObjectURL(blob), name: `video-${Date.now()}.${ext}` })
      }
      recorder.start(1000)
    }

    const startAt = audio.currentTime + 0.1
    source?.start(startAt)
    let raf = 0
    let stopped = false
    const stop = () => {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(raf)
      source?.stop()
      if (recorder?.state === 'recording') recorder.stop()
      setTimeout(() => audio.close(), 300)
      stopRef.current = null
      setMode('idle')
    }
    stopRef.current = stop
    setMode(record ? 'exporting' : 'playing')

    const tick = () => {
      const t = Math.max(0, audio.currentTime - startAt)
      drawFrame(ctx2d, sched, images, project, t)
      drawCaptions(ctx2d, captions, captionStyle, t)
      setTime(t)
      if (t >= duration) return stop()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  }

  const { width, height } = project
  return (
    <div className="player">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ aspectRatio: `${width} / ${height}`, maxHeight: 480, width: 'auto', maxWidth: '100%' }}
      />
      <div className="row">
        {mode === 'idle' ? (
          <>
            <button disabled={!sched.length} onClick={() => run(false)}>
              ▶ ניגון
            </button>
            <button disabled={!sched.length} onClick={() => run(true)}>
              ייצוא וידאו
            </button>
          </>
        ) : (
          <button onClick={() => stopRef.current?.()}>■ עצירה</button>
        )}
        <span>
          {time.toFixed(1)} / {duration.toFixed(1)} שניות · {sched.length} תמונות
        </span>
        {mode === 'exporting' && <span className="status">מקליט בזמן אמת, אל תעבור לטאב אחר…</span>}
        {download && (
          <a className="btn" href={download.url} download={download.name}>
            הורדת {download.name}
          </a>
        )}
      </div>
      {track && sched.length * cutEvery(project, track.beats) > track.beats.length && (
        <p className="hint">יש יותר תמונות מביטים בשיר; התמונות האחרונות יקבלו משך קבוע.</p>
      )}
      {captions.length > 0 && !captions.some((c) => c.end > 0) && (
        <p className="warn">הכתוביות עדיין לא מתוזמנות, ולכן לא מופיעות. סנכרן אותן בשלב 6 (אוטומטית או בהקשה).</p>
      )}
      {sched.length > 0 && lateCaptions > 0 && (
        <p className="warn">
          {lateCaptions} שורות כתוביות מתחילות אחרי שהסרטון נגמר (בשנייה {duration.toFixed(1)}), ולכן לא יופיעו.
          {track && project.beatsPerCut !== 0 && (
            <>
              {' '}
              <button className="mini" onClick={onFitSong}>
                מתח את התמונות על כל השיר
              </button>
            </>
          )}
          {(!track || project.beatsPerCut === 0) && ' הוסף עוד תמונות לסרטון, או הגדל את משך כל תמונה.'}
        </p>
      )}
    </div>
  )
}
