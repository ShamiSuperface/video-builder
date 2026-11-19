import { useEffect, useRef, useState } from 'react'
import { blurDecisions, coverArea, obscureFaces } from './lib/blur'
import { faceDetails, type FaceDetail } from './lib/faces'
import { loadImage } from './lib/photos'
import type { BlurSettings, Person, Photo } from './lib/types'

interface Props {
  photo: Photo
  people: Person[]
  threshold: number
  settings: BlurSettings
  overrides: Record<number, boolean>
  onChange: (overrides: Record<number, boolean>) => void
  onClose: () => void
}

/** The photo with a clickable box on every face: click to blur or unblur that face. */
export default function FaceBlurEditor({ photo, people, threshold, settings, overrides, onChange, onClose }: Props) {
  const [faces, setFaces] = useState<FaceDetail[] | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = img && { w: img.naturalWidth, h: img.naturalHeight }

  useEffect(() => {
    let alive = true
    Promise.all([faceDetails(photo.url), loadImage(photo.url)]).then(([f, im]) => {
      if (!alive) return
      setFaces(f)
      setImg(im)
    })
    return () => {
      alive = false
    }
  }, [photo.url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const d = faces && blurDecisions(faces, people, threshold, settings, overrides)
  const names = new Map(people.map((p) => [p.id, p.name]))

  // The preview uses the same drawing as the export, so it shows exactly what will be hidden.
  const blurredKey = d?.blurred.join(',')
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !img || !faces || !d) return
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const full = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
    obscureFaces(ctx, img, full, faces.filter((_, i) => d.blurred[i]).map((f) => f.box), settings.style)
    // d is recomputed every render; blurredKey captures what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, faces, blurredKey, settings.style])

  function toggle(i: number) {
    if (!d) return
    const next = { ...overrides }
    const want = !d.blurred[i]
    // A choice that matches the automatic one isn't an override.
    if (want === d.auto[i]) delete next[i]
    else next[i] = want
    onChange(next)
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <strong>טשטוש פנים: {photo.name}</strong>
          <span className="hint">לחץ על פנים כדי לטשטש או לבטל טשטוש.</span>
          <button className="mini secondary" onClick={() => onChange({})} disabled={!Object.keys(overrides).length}>
            חזור לאוטומטי
          </button>
          <button className="mini" onClick={onClose}>
            סגור
          </button>
        </div>
        <div className="face-stage">
          {img ? <canvas ref={canvasRef} /> : <img src={photo.url} />}
          {d &&
            size &&
            faces!.map((f, i) => {
              const a = coverArea(f.box, size.w, size.h)
              const who = d.who[i] ? names.get(d.who[i]!) : null
              return (
                <button
                  key={i}
                  className={`face-box ${d.blurred[i] ? 'blurred' : ''} ${i in overrides ? 'manual' : ''}`}
                  style={{
                    left: `${(a.x / size.w) * 100}%`,
                    top: `${(a.y / size.h) * 100}%`,
                    width: `${(a.w / size.w) * 100}%`,
                    height: `${(a.h / size.h) * 100}%`,
                  }}
                  title={`${who ?? 'לא מזוהה'}${d.blurred[i] ? ' · מטושטש' : ''}${i in overrides ? ' (ידני)' : ''}`}
                  onClick={() => toggle(i)}
                >
                  <span>{who ?? '?'}</span>
                </button>
              )
            })}
        </div>
        {!faces && <p className="hint">מחפש פנים בתמונה…</p>}
        {faces && !faces.length && <p className="hint">לא נמצאו פנים בתמונה הזו.</p>}
      </div>
    </div>
  )
}
