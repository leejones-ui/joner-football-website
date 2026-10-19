"use client"

import { useEffect, useRef, useState } from "react"

// The in-page replacement for window.confirm and window.prompt.
//
// Lee's browser suppresses native dialogs, so a button that opened one looked
// dead: no question, no result, nothing. Six places still did that on 9 Sep
// 2026 (rename team, remove member, copy a link, remove coach, player display
// name, remove from club library). Everything that asks a question now asks
// it on the page, where it can be seen, read by a screen reader, and answered
// with a keyboard.
//
// mode "confirm": title, body, a red or dark confirm button.
// mode "prompt": the same plus one text field; onConfirm receives its value.
// mode "copy":   shows a value in a read-only field with a Select all, for
//                when the clipboard API is refused.
export default function ConfirmSheet({ open, mode = "confirm", title, body, label, placeholder, initialValue = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, busy = false, onConfirm, onClose }) {
  const [value, setValue] = useState(initialValue)
  const first = useRef(null)
  const restore = useRef(null)

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    restore.current = document.activeElement
    const t = setTimeout(() => first.current?.focus?.(), 0)
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose?.() } }
    window.addEventListener("keydown", onKey)
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); restore.current?.focus?.() }
  }, [open, initialValue, onClose])

  if (!open) return null
  const submit = (e) => { e?.preventDefault?.(); if (busy) return; if (mode === "prompt" && !String(value).trim()) return; onConfirm?.(mode === "prompt" ? String(value).trim() : undefined) }

  return (
    <>
      <button type="button" className="tsheet-backdrop" aria-label={cancelLabel} onClick={onClose} />
      <form className="tsheet" role="dialog" aria-modal="true" aria-labelledby="tsheet-title" onSubmit={submit}>
        <h2 id="tsheet-title" className="tsheet-title">{title}</h2>
        {body ? <p className="tsheet-body">{body}</p> : null}
        {mode === "prompt" ? (
          <label className="tsheet-field">
            {label ? <span>{label}</span> : null}
            <input ref={first} value={value} placeholder={placeholder} maxLength={80} onChange={(e) => setValue(e.target.value)} />
          </label>
        ) : null}
        {mode === "copy" ? (
          <label className="tsheet-field">
            {label ? <span>{label}</span> : null}
            <input ref={first} value={initialValue} readOnly onFocus={(e) => e.target.select()} />
          </label>
        ) : null}
        <div className="tsheet-actions">
          <button type="button" className="tsheet-cancel" onClick={onClose} disabled={busy}>{mode === "copy" ? "Done" : cancelLabel}</button>
          {mode !== "copy" ? <button ref={mode === "confirm" ? first : null} type="submit" className={`tsheet-confirm${danger ? " danger" : ""}`} disabled={busy || (mode === "prompt" && !String(value).trim())}>{busy ? "Working" : confirmLabel}</button> : null}
        </div>
      </form>
    </>
  )
}
