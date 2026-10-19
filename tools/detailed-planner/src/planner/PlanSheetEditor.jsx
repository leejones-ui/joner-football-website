"use client"
// The writing side of a session plan, given room to breathe.
//
// The notes used to live in two-row boxes squeezed under the pitch, which is
// hopeless when a coach is actually writing coaching points. This is a proper
// workspace: full height, fields that grow as you type, and everything a coach
// writes in one place: the sequence script, the notes, the video and the APP
// links.
import { useCallback, useEffect, useRef } from "react"

function GrowingTextarea({ value, onChange, placeholder, minRows = 4, id }) {
  const ref = useRef(null)
  const width = useRef(0)
  // Height follows the content, so long coaching points are never hidden
  // behind a scrollbar inside a tiny box.
  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.max(el.scrollHeight, minRows * 24)}px`
  }, [minRows])
  useEffect(() => { fit() }, [value, fit])
  // A measurement taken before the sheet has its final width wraps the text far
  // more than it really will, which left a ten line note sitting in a box
  // thousands of pixels tall. So measure again once layout settles, and on any
  // width change, guarded on width, because reacting to our own height change
  // would loop forever.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    width.current = el.clientWidth
    const frame = requestAnimationFrame(fit)
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width)
      if (next === width.current) return
      width.current = next
      fit()
    })
    observer.observe(el)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [fit])
  return (
    <textarea
      id={id}
      ref={ref}
      value={value}
      placeholder={placeholder}
      rows={minRows}
      onChange={(event) => { onChange(event.target.value); fit() }}
    />
  )
}

export default function PlanSheetEditor({
  open,
  onClose,
  plan,
  scene,
  sceneIndex,
  steps,
  noteFields,
  noteHints,
  emptyNotes,
  onEditPlan,
  onEditScene,
  normalizeUrl,
  onAddLink,
  onRemoveLink,
  linkDraft,
  onLinkDraft,
}) {
  const closeRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onKey = (event) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    closeRef.current?.focus()
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const stepNotes = scene?.stepNotes || {}
  const setStepNote = (step, text) => {
    onEditScene((current) => {
      const next = { ...(current.stepNotes || {}) }
      if (text.trim()) next[String(step)] = text
      else delete next[String(step)]
      return { ...current, stepNotes: Object.keys(next).length ? next : undefined }
    })
  }
  const setNote = (key, text) => {
    onEditPlan((value) => ({
      ...value,
      notesSections: { ...emptyNotes, ...value.notesSections, [key]: text },
    }))
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-label="Session plan notes">
      <div className="sheet-panel">
        <header className="sheet-head">
          <div>
            <span className="sheet-kicker">Session plan</span>
            <h2>{plan.title || "Untitled session"}</h2>
          </div>
          <button ref={closeRef} className="primary-button" onClick={onClose}>Done</button>
        </header>

        <div className="sheet-body">
          <section className="sheet-col">
            <div className="sheet-block">
              <div className="sheet-block-head">
                <h3>The sequence</h3>
                <p>
                  {steps.length > 1
                    ? `One line per numbered step in "${scene?.name || `Scene ${sceneIndex + 1}`}". This is what makes the printed sheet read like a coaching script.`
                    : "Number the steps on the pitch first (the Number steps button), then write a line for each one here."}
                </p>
              </div>
              {steps.length > 1 ? (
                <ol className="sheet-steps">
                  {steps.map((step) => (
                    <li key={step}>
                      <span className="sheet-step-no">{step}</span>
                      <GrowingTextarea
                        minRows={2}
                        value={stepNotes[String(step)] ?? ""}
                        placeholder={step === 1 ? "e.g. Striker drops in, first pass goes wide" : "What happens on this step?"}
                        onChange={(text) => setStepNote(step, text)}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="sheet-empty">
                  Everything in this scene currently plays at once, so there is no sequence to describe yet.
                </p>
              )}
            </div>

            <div className="sheet-block">
              <div className="sheet-block-head">
                <h3>Session video</h3>
                <p>Stays clickable on the printed sheet and in the PDF.</p>
              </div>
              <div className="sheet-inline">
                <input
                  type="url"
                  placeholder="Paste a JF APP or YouTube link"
                  value={plan.videoUrl ?? ""}
                  onChange={(event) => onEditPlan((value) => ({ ...value, videoUrl: event.target.value }))}
                  onBlur={(event) => {
                    const v = event.target.value.trim()
                    if (v) onEditPlan((value) => ({ ...value, videoUrl: normalizeUrl(v) }))
                  }}
                />
                {plan.videoUrl && (
                  <a className="secondary-button" href={normalizeUrl(plan.videoUrl)} target="_blank" rel="noopener noreferrer">Watch</a>
                )}
              </div>
            </div>

            <div className="sheet-block">
              <div className="sheet-block-head">
                <h3>Joner Football APP links</h3>
                <p>Attach drills or videos so coaches can tap straight through.</p>
              </div>
              {plan.links.length > 0 && (
                <ul className="sheet-links">
                  {plan.links.map((link) => (
                    <li key={link.id}>
                      <a href={normalizeUrl(link.url)} target="_blank" rel="noopener noreferrer">
                        {link.label || link.url}
                      </a>
                      <button className="icon-button" aria-label={`Remove ${link.label || link.url}`} onClick={() => onRemoveLink(link.id)}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="sheet-link-form">
                <input
                  placeholder="Label, e.g. 1v1 finishing drill"
                  value={linkDraft.label}
                  onChange={(event) => onLinkDraft({ ...linkDraft, label: event.target.value })}
                />
                <input
                  placeholder="Link, e.g. jonerfootball.com/drill"
                  value={linkDraft.url}
                  onChange={(event) => onLinkDraft({ ...linkDraft, url: event.target.value })}
                  onKeyDown={(event) => { if (event.key === "Enter" && linkDraft.url.trim()) onAddLink() }}
                />
                <button className="secondary-button" disabled={!linkDraft.url.trim()} onClick={onAddLink}>Add link</button>
              </div>
            </div>
          </section>

          <section className="sheet-col">
            {noteFields.map(([key, label]) => (
              <div className="sheet-block" key={key}>
                <div className="sheet-block-head">
                  <h3><label htmlFor={`note-${key}`}>{label}</label></h3>
                </div>
                <GrowingTextarea
                  id={`note-${key}`}
                  minRows={key === "develops" || key === "note" ? 2 : 5}
                  value={plan.notesSections?.[key] ?? ""}
                  placeholder={noteHints[key] || ""}
                  onChange={(text) => setNote(key, text)}
                />
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}
