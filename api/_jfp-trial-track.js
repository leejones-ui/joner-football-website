// Trial tracker (Lee, 20 Oct 2026: "Every trial shows as booked, came,
// followed up, then paid or lost, so none slip through"). Built on Trial
// feedback: each trial's steps come from what is already recorded (the trial
// row, the coach's register, the coach's feedback, Lee or Ligia's decision,
// the Term 4 row once they pay) plus one new record, the follow up:
//
//   jfp:trial-followup   hash rowId -> JSON {at, by, byName, note, outcome}
//                        outcome: 'thinking' (still deciding) | 'lost' (not coming)
//
// A trial is stuck when its date was 5 or more days ago and it has neither an
// outcome nor a follow up in the last 7 days. Nothing here sends anything.
import { kvCommand, clean, audit } from './_jfp-store.js'

export const FOLLOWUP = 'jfp:trial-followup'
export const OUTCOMES = { thinking: 'Still deciding', lost: 'Not coming' }
export const STEPS = [['booked', 'Booked'], ['came', 'Came'], ['feedback', 'Coach feedback'], ['offered', 'Place offered'], ['followed', 'Followed up'], ['paid', 'Paid']]
const DAY = 86400000
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)

export async function followUpsAll() {
  const raw = (await kvCommand(['HGETALL', FOLLOWUP])) || []
  const out = {}
  for (let i = 0; i + 1 < raw.length; i += 2) { try { out[raw[i]] = JSON.parse(raw[i + 1]) } catch {} }
  return out
}

export async function saveFollowUp(principal, { rowId, note, outcome }) {
  const id = clean(rowId, 30)
  if (!id) return { error: 'Which trial?' }
  if (outcome === 'undo') { await kvCommand(['HDEL', FOLLOWUP, id]); await audit({ by: principal.email, action: 'trial.followup', target: id, after: { outcome: 'undo' } }); return { followUp: null } }
  const rec = { at: new Date().toISOString(), by: principal.email, byName: principal.name || '', note: clean(note, 300), outcome: Object.prototype.hasOwnProperty.call(OUTCOMES, outcome) ? outcome : 'thinking' }
  await kvCommand(['HSET', FOLLOWUP, id, JSON.stringify(rec)])
  await audit({ by: principal.email, action: 'trial.followup', target: id, after: { outcome: rec.outcome } })
  return { followUp: rec }
}

// What the register says about the trial date: came | missed | unmarked | '' (still to come).
export function cameFrom(mark, trialDate, today) {
  if (!trialDate || trialDate > today) return ''
  if (mark === 'Present') return 'came'
  if (mark === 'Absent' || mark === 'Notified') return 'missed'
  return 'unmarked'
}

// x: a trialsData item (stillTrial, paymentStatus, holdsPlace, feedback, decision, trialDate)
// plus came and followUp. -> { stage, done: {step: true}, outcome, stuck }
export function trialStage(x, today) {
  const paid = !x.stillTrial && x.holdsPlace && /^(paid|partially paid)$/i.test(x.paymentStatus || '')
  const lost = !paid && (x.decision?.decision === 'declined' || x.followUp?.outcome === 'lost' || (!x.stillTrial && !x.holdsPlace))
  const offered = ['accepted', 'moved'].includes(x.decision?.decision) || (!x.stillTrial && x.holdsPlace)
  const done = {
    booked: true,
    came: x.came === 'came' || Boolean(x.feedback) || paid,
    feedback: Boolean(x.feedback),
    offered,
    followed: Boolean(x.followUp),
    paid,
  }
  const outcome = paid ? 'paid' : lost ? 'lost' : 'open'
  const stage = paid ? 'paid' : lost ? 'lost' : x.followUp ? 'followed' : offered ? 'offered' : x.feedback ? 'feedback' : x.came === 'came' ? 'came' : x.came === 'missed' ? 'missed' : 'booked'
  const since = x.trialDate ? days(x.trialDate, today) : null
  const recentFollow = x.followUp && days(x.followUp.at.slice(0, 10), today) < 7
  const stuck = outcome === 'open' && since != null && since >= 5 && !recentFollow
  return { stage, done, outcome, stuck, daysSince: since }
}

// The counts across the top of the page.
export function pipelineCounts(items) {
  const c = { booked: 0, came: 0, feedback: 0, offered: 0, followed: 0, paid: 0, lost: 0, missed: 0, stuck: 0 }
  for (const x of items) { c[x.track.stage] = (c[x.track.stage] || 0) + 1; if (x.track.stuck) c.stuck += 1 }
  return c
}
