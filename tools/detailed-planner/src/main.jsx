// Entry for the JFP detailed session planner. Teams talks to /api/session-plans;
// here those calls are translated to the JFP coach portal API (jfp-portal-data)
// by a small fetch shim, so the planner code stays as it was in Teams.
import React from "react"
import { createRoot } from "react-dom/client"
import SessionPlanner from "./planner/SessionPlanner.jsx"
import { plannerIntent } from "./lib/planner-drafts.js"
import "./planner/planner.css"
import "./extras.css"

const API = "/api/jfp-portal-data"
const realFetch = window.fetch.bind(window)
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
async function portal(action, body = {}) {
  const r = await realFetch(API, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) })
  const data = await r.json().catch(() => ({}))
  return { status: r.status, data }
}
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.origin)
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/session-plans")) return realFetch(input, init)
  const method = (init.method || "GET").toUpperCase()
  const rest = url.pathname.replace(/^\/api\/session-plans\/?/, "")
  let out
  if (rest === "library") {
    if (method === "GET") out = await portal("plan2Library")
    else { const b = JSON.parse(init.body || "{}"); out = b.action === "use" ? await portal("plan2Use", { planId: b.planId }) : { status: 400, data: { error: "Not available in the JFP portal." } } }
  } else if (!rest) {
    if (method === "GET") out = await portal("plan2List")
    else { const b = JSON.parse(init.body || "{}"); out = await portal("plan2Save", { id: b.id, plan: b.plan }) }
  } else {
    const id = decodeURIComponent(rest)
    out = method === "DELETE" ? await portal("plan2Delete", { id }) : await portal("plan2Get", { id })
  }
  if (out.status === 401) return reply(401, { error: "Sign in to the JFP portal first, then save again." })
  return reply(out.status, out.data)
}

const root = createRoot(document.getElementById("root"))
function Notice({ title, text, href, label }) {
  return <div className="jfp-gate"><h1>{title}</h1><p>{text}</p>{href && <a href={href}>{label}</a>}</div>
}
async function start() {
  let me
  try { me = await portal("me") } catch { me = { status: 0, data: {} } }
  if (me.status === 401) return root.render(<Notice title="Sign in first" text="The detailed session planner is for JFP coaches. Sign in to the coach portal, then open it from Session plans." href="/jfp-portal/" label="Go to the coach portal" />)
  if (me.status !== 200 || !me.data.user) return root.render(<Notice title="Planner unavailable" text={me.data.error || "Please try again in a minute."} href="/jfp-portal/#plans" label="Back to Session plans" />)
  const slug = String(me.data.user.email || "coach").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)
  // Drafts on a shared device are kept per coach: the team id is only a storage key here.
  if (window.innerWidth < 700) { const n = document.createElement("div"); n.className = "jfp-phone-note"; n.textContent = "This planner works best on an iPad or a computer. You can still open and save sessions on a phone."; n.onclick = () => n.remove(); document.body.prepend(n) }
  root.render(<SessionPlanner teamId={`jfp-${slug}`} teamName="Joner Football Performance" roster={[]} clubDefaults={null} intent={plannerIntent(new URLSearchParams(location.search))} />)
}
start()
