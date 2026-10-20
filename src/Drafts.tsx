import { useEffect, useState } from 'react'
import { deleteDraft, listDrafts, type DraftSummary } from './lib/drafts'

interface Props {
  /** Bumped after each save so the list refreshes. */
  version: number
  currentId: string | null
  onOpen: (id: string) => void
  onDeleted: (id: string) => void
}

const fmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' })

function Thumb({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url ? <img src={url} alt="" /> : <div className="thumb-empty" />
}

export default function Drafts({ version, currentId, onOpen, onDeleted }: Props) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    listDrafts()
      .then(setDrafts)
      .catch(() => setDrafts([]))
  }, [version])

  // On first visit with saved drafts, show them so the user can pick up where they left off.
  useEffect(() => {
    if (drafts.length && !currentId) setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts.length])

  if (!drafts.length) return null

  async function remove(id: string) {
    await deleteDraft(id)
    setConfirmDelete(null)
    setDrafts((d) => d.filter((x) => x.id !== id))
    onDeleted(id)
  }

  return (
    <section className="drafts">
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} טיוטות שמורות ({drafts.length})
      </button>
      {open && (
        <ul>
          {drafts.map((d) => (
            <li key={d.id} className={d.id === currentId ? 'current' : ''}>
              <Thumb blob={d.thumb} />
              <div className="meta">
                <strong>{d.name}</strong>
                <span>
                  {fmt.format(d.updatedAt)} · {d.clipCount} תמונות בסרטון
                </span>
              </div>
              {d.id === currentId ? (
                <span className="badge">פתוחה עכשיו</span>
              ) : (
                <button
                  onClick={() => {
                    onOpen(d.id)
                    setOpen(false)
                  }}
                >
                  פתח
                </button>
              )}
              {confirmDelete === d.id ? (
                <>
                  <button className="danger" onClick={() => remove(d.id)}>
                    כן, למחוק
                  </button>
                  <button className="secondary" onClick={() => setConfirmDelete(null)}>
                    ביטול
                  </button>
                </>
              ) : (
                <button className="secondary" onClick={() => setConfirmDelete(d.id)}>
                  מחק
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
