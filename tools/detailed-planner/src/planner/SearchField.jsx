"use client"
import { useRef } from "react"

// The one search box for every portal.
//
// Lee, 14 Sep 2026: the App picker and the YouTube picker sat side by side
// with two different search boxes, and the portals had nine hand-rolled ones
// between them. This is the only one now. Styling lives in app/globals.css
// under .psearch, so a page module cannot drift from it.
export default function SearchField({ value, onChange, placeholder, label, className = "", autoFocus = false, ...rest }) {
  const inputRef = useRef(null)
  return (
    <div role="search" className={`psearch ${className}`.trim()}>
      <span className="psearch-ico" aria-hidden="true">⌕</span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label || placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        {...rest}
      />
      {value && !rest.disabled && <button type="button" className="psearch-clear" aria-label={`Clear ${label || placeholder || "search"}`} onClick={() => { onChange(""); inputRef.current?.focus() }}>×</button>}
    </div>
  )
}
