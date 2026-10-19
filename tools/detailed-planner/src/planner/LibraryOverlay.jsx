"use client"

import { useEffect, useMemo, useState } from "react"
import ConfirmSheet from "./ConfirmSheet.jsx"
import SearchField from "./SearchField.jsx"

// The Curriculum Library: My Sessions / Club Library / Joner Academy.
// Coaches keep their own shelf, the Club Manager curates the club shelf,
// and the Academy shelf carries Lee's drill packs once they're loaded.
const SHELVES = [
  ["mine", "My Sessions"],
  ["academy", "Lee's library"],
]

function MiniPitch({ preview }) {
  const dots = preview?.dots || []
  return (
    <svg viewBox="0 0 100 64" className="lib-mini" aria-hidden="true">
      <rect x="1" y="1" width="98" height="62" rx="4" fill="#1f7a3d" stroke="rgba(255,255,255,0.35)" />
      <line x1="50" y1="1" x2="50" y2="63" stroke="rgba(255,255,255,0.3)" />
      <circle cx="50" cy="32" r="9" fill="none" stroke="rgba(255,255,255,0.3)" />
      {dots.map((d, i) => (
        <circle key={i} cx={Math.max(4, Math.min(96, d.x * 100))} cy={Math.max(4, Math.min(60, d.y * 64))} r="3.2" fill={d.c || "#e8000d"} stroke="rgba(255,255,255,0.7)" strokeWidth="0.8" />
      ))}
    </svg>
  )
}

export default function LibraryOverlay({
  open, onClose, teamId, teamName,
  savedPlans, currentPlanId, onOpenPlan, onDeletePlan, onNewSession, onSaveCopy, cloudBusy,
}) {
  const [shelf, setShelf] = useState("mine")
  const [q, setQ] = useState("")
  const [shelves, setShelves] = useState({ club: [], academy: [], isManager: false })
  const [removeEntry, setRemoveEntry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!open || !teamId) return
    setLoading(true)
    fetch(`/api/session-plans/library?team=${encodeURIComponent(teamId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setShelves({ club: data.club || [], academy: data.academy || [], isManager: Boolean(data.isManager) }))
      .catch(() => setMessage("Could not load the library just now."))
      .finally(() => setLoading(false))
  }, [open, teamId])

  const rows = useMemo(() => {
    const source = shelf === "mine" ? savedPlans : shelf === "club" ? shelves.club : shelves.academy
    const term = q.trim().toLowerCase()
    return term ? source.filter((p) => (p.title || "").toLowerCase().includes(term)) : source
  }, [shelf, q, savedPlans, shelves])

  async function act(action, planId, source) {
    setBusyId(planId); setMessage("")
    try {
    const res = await fetch("/api/session-plans/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, action, planId, source }),
    })
    const out = await res.json().catch(() => ({}))
    setBusyId("")
    if (!res.ok) { setMessage(out.error || "That didn't work."); return null }
    return out
    } catch { setMessage("Could not reach the library. Please try again."); return null }
    finally { setBusyId("") }
  }

  async function publish(entry) {
    const out = await act("publish", entry.id)
    if (out) {
      setMessage(`"${entry.title || "Session"}" published to the Club Library.`)
      setShelves((s) => ({ ...s, club: [{ ...entry, id: out.id }, ...s.club] }))
    }
  }
  async function removeFromClub(entry) {
    setRemoveEntry(null)
    const out = await act("remove", entry.id)
    if (out) setShelves((s) => ({ ...s, club: s.club.filter((p) => p.id !== entry.id) }))
  }
  async function useSession(entry, source) {
    const out = await act("use", entry.id, source)
    if (out) {
      setMessage(`Added to My Sessions - opening it now.`)
      onOpenPlan({ id: out.id, title: entry.title })
      onClose()
    }
  }

  if (!open) return null
  return (<>
    <div className="lib-overlay" role="dialog" aria-label="Curriculum Library">
      <div className="lib-panel">
        <div className="lib-head">
          <div>
            <span className="lib-kicker">Session library</span>
            <h2>{teamName || "Your team"}</h2>
          </div>
          <div className="lib-head-actions">
            <button className="secondary-button" onClick={() => { onNewSession(); onClose() }}>+ New session</button>
            <button className="icon-button" aria-label="Close library" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="lib-tabs">
          {SHELVES.map(([key, label]) => (
            <button key={key} className={shelf === key ? "is-on" : ""} onClick={() => { setShelf(key); setMessage("") }}>
              {label}
              <span className="lib-count">{key === "mine" ? savedPlans.length : key === "club" ? shelves.club.length : shelves.academy.length}</span>
            </button>
          ))}
          <SearchField className="lib-search" placeholder="Search sessions" value={q} onChange={setQ} />
        </div>

        {message && <div className="lib-message">{message}</div>}
        {loading && shelf !== "mine" && <div className="lib-empty">Loading the library...</div>}

        <div className="lib-grid">
          {rows.map((entry) => (
            <article key={entry.id} className={`lib-card ${entry.id === currentPlanId && shelf === "mine" ? "is-current" : ""}`}>
              <MiniPitch preview={entry.preview} />
              <div className="lib-card-body">
                <strong>{entry.title || "Untitled session"}</strong>
                <span>
                  {entry.scenes || 1} scene{(entry.scenes || 1) === 1 ? "" : "s"}
                  {entry.videoUrl ? " · ▶ video" : ""}
                  {entry.updatedAt ? ` · ${new Date(entry.updatedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}` : ""}
                </span>
                {entry.savedBy && <span className="lib-card-by">Saved by {entry.savedBy}</span>}
              </div>
              <div className="lib-card-actions">
                {shelf === "mine" && <>
                  <button className="lib-primary" onClick={() => { onOpenPlan(entry); onClose() }}>Open</button>
                  
                  <button className="lib-danger" onClick={() => onDeletePlan(entry)}>Delete</button>
                </>}
                {shelf === "club" && <>
                  <button className="lib-primary" disabled={busyId === entry.id} onClick={() => useSession(entry, "club")}>{busyId === entry.id ? "Adding..." : "Use editable copy"}</button>
                  {shelves.isManager && <button className="lib-danger" disabled={busyId === entry.id} onClick={() => setRemoveEntry(entry)}>Remove</button>}
                </>}
                {shelf === "academy" && (
                  <button className="lib-primary" disabled={busyId === entry.id} onClick={() => useSession(entry, "academy")}>{busyId === entry.id ? "Adding..." : "Use editable copy"}</button>
                )}
              </div>
            </article>
          ))}
          {!rows.length && !loading && (
            <div className="lib-empty">
              {shelf === "mine" && "No saved sessions yet. Build one and hit Save. Lee and Ligia can see every coach's saved sessions."}
              {shelf === "club" && (shelves.isManager
                ? "Nothing published yet. Open one of your sessions and hit Publish to club to build your club's curriculum."
                : "Your Club Manager hasn't published any sessions yet. Anything they publish appears here for every coach in the club.")}
              {shelf === "academy" && "Lee has not saved any detailed sessions yet."}
            </div>
          )}
        </div>

        {shelf === "mine" && (
          <div className="lib-foot">
            <button className="secondary-button" disabled={cloudBusy} onClick={onSaveCopy}>Save current as copy</button>
          </div>
        )}
      </div>
    </div>
  {<ConfirmSheet open={Boolean(removeEntry)} title={`Remove "${removeEntry?.title || "this session"}" from the Club Library?`} body="Coaches' own copies are unaffected." confirmLabel="Remove" danger onConfirm={() => removeFromClub(removeEntry)} onClose={() => setRemoveEntry(null)} />}
  </>)
}
