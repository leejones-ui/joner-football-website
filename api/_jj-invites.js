// Joners Juniors invites (stage 2), the Juniors twin of JFP's familyPlan /
// familyInvites: preview the email, choose the families, send in batches.
// Nothing is sent until a staff member presses Send. Every send is recorded
// (who was sent what, when, by whom, how many times) and audited.
//
// Three kinds (Lee, 13 Oct 2026; no trial invites):
//   new       sign in to the family account (the same login as JFP) and pay
//             this term's fee: a Juniors payment request for what is owing.
//   next      re-enrol for next term (config.juniors.nextTerm): hold the place
//             or pay in full in the account. Needs next term's Airtable table.
//   reminder  unpaid and/or no waiver, with the amount still owing.
//
// Families are grouped by the first parent email on the row (as JFP). The
// amounts come from Juniors Money (Stripe, the Juniors ledger, Airtable), so a
// family who paid on a payment link or in cash is never asked again.
//
// KV:
//   jj:invites                      hash  "<kind>:<email>" -> { at, by, count, payreqId, amountCents, term }
//   jj:invite-lock:<kind>:<email>   10 minutes, so a double tap or two staff never email twice
import { kvCommand, audit, validEmail } from './_jfp-store.js'
import { tableFor } from './_jj-data.js'
import { nextTermOf } from './_jj-config.js'
import { jjAccountInvite, jjReminder, jjNextInvite, sendJJFamilyEmail } from './_jj-email.js'
import { listJJPayreqs, jjViews, isOpen, ensureTermPayreq, jjPayreqUrl, jjNextStatuses, setJJNextStatus } from './_jj-pay.js'

export const KINDS = ['new', 'next', 'reminder']
export const INVITES = 'jj:invites'
const BATCH = 10
const hashOf = (raw) => { const o = {}; for (let i = 0; i + 1 < (raw || []).length; i += 2) o[raw[i]] = raw[i + 1]; return o }

export async function readInvites() {
  const o = hashOf(await kvCommand(['HGETALL', INVITES]))
  for (const k of Object.keys(o)) { try { o[k] = JSON.parse(o[k]) } catch { delete o[k] } }
  return o
}

// overview: jjOverview(config) for the current term (children with money).
export async function invitePlan(config, overview, kind, { site = '', filter = 'both' } = {}) {
  const jj = config.juniors
  const nt = nextTermOf(jj)
  const [invites, signedRaw, payreqs, views, nextSt] = await Promise.all([readInvites(), kvCommand(['HGETALL', 'jfp:acct-signedin']), listJJPayreqs(), jjViews(), kind === 'next' ? jjNextStatuses(nt.name) : Promise.resolve({})])
  const signedIn = hashOf(signedRaw)
  const fams = new Map(), noEmail = []
  for (const p of overview.players.filter((x) => !x.removed)) {
    const email = validEmail(p.emails?.[0] || '')
    if (!email) { noEmail.push({ name: p.name, parent: p.parent }); continue }
    if (!fams.has(email)) fams.set(email, [])
    fams.get(email).push(p)
  }
  const list = [...fams.entries()].map(([email, kids]) => {
    const owe = (p) => (['unpaid', 'part'].includes(p.pay) ? p.owingCents : 0)
    const owingKnown = kids.every((p) => owe(p) != null)
    const owingCents = kids.reduce((t, p) => t + (owe(p) || 0), 0)
    const needsWaiver = kids.some((p) => !p.waiver.onFile && !p.waiver.unknown)
    const open = payreqs.find((q) => isOpen(q) && q.kind === 'term' && q.rowIds.some((id) => kids.some((k) => k.rowId === id)))
    const sent = invites[`${kind}:${email}`] || null
    const children = kids.map((p) => ({
      rowId: p.rowId, classId: p.classId || '', name: p.name, pay: p.pay, payLabel: p.payLabel, owingCents: owe(p), waiver: p.waiver.onFile, needsWaiver: !p.waiver.onFile && !p.waiver.unknown,
      ...(kind === 'next' ? { next: nextSt[p.rowId]?.status || '' } : {}),
    }))
    let todo, status
    if (kind === 'next') {
      todo = children.some((c) => !['held', 'paid', 'no'].includes(c.next))
      status = children.every((c) => c.next === 'paid') ? 'paid' : children.every((c) => ['held', 'paid', 'no'].includes(c.next)) ? 'answered' : sent ? (signedIn[email] && signedIn[email] > sent.at ? 'opened' : 'sent') : 'not sent'
    } else {
      const wantMoney = kind === 'new' || filter !== 'waiver'
      const wantWaiver = kind === 'new' || filter !== 'unpaid'
      todo = kind === 'new' ? true : (wantMoney && owingCents > 0) || (wantWaiver && needsWaiver) || (wantMoney && !owingKnown)
      const opened = (open && Number(views.views[open.id]) > 0) || (sent && signedIn[email] && signedIn[email] > sent.at)
      status = owingKnown && !owingCents && (kind === 'new' || !needsWaiver || filter === 'unpaid') ? 'paid' : sent ? (opened ? 'opened' : 'sent') : 'not sent'
    }
    return {
      email, parent: kids[0].parent, children, owingCents, owingKnown, needsWaiver, todo, status,
      sentAt: sent?.at || '', sentBy: sent?.by || '', sentCount: sent?.count || 0, signedInAt: signedIn[email] || '',
      openPayreq: open ? { id: open.id, amountCents: open.amountCents, views: Number(views.views[open.id]) || 0, viewedAt: views.viewedAt[open.id] || '', status: open.status, url: jjPayreqUrl(site, open) } : null,
    }
  }).filter((f) => kind !== 'reminder' || f.todo || f.sentAt).sort((a, b) => a.parent.localeCompare(b.parent))
  const blocked = kind === 'next' ? (!nt.name ? 'Name next term in Settings first.' : !nt.table ? `Add the Airtable table for ${nt.name} in Settings (Airtable tables) first. Re-enrolled children go into that table when the family pays.` : '') : ''
  const counts = { families: list.length, notSent: list.filter((f) => f.status === 'not sent').length, sent: list.filter((f) => f.status === 'sent').length, opened: list.filter((f) => f.status === 'opened').length, paid: list.filter((f) => ['paid', 'answered'].includes(f.status)).length }
  return { kind, list, noEmail, blocked, counts, term: jj.term, next: kind === 'next' ? { name: nt.name, fullCents: nt.fullCents, holdCents: nt.holdCents, table: Boolean(nt.table), open: nt.open } : null, moneyError: overview.moneyError || '' }
}

// The email one family would get (the same function the send uses).
function buildFor(kind, f, config, { site, payUrl = '' }) {
  const jj = config.juniors
  const signInUrl = `${site}/jfp-account/`
  if (kind === 'next') return jjNextInvite({ parentName: f.parent, children: f.children.filter((c) => !['held', 'paid', 'no'].includes(c.next)), jj, url: signInUrl, email: f.email })
  if (kind === 'new') return jjAccountInvite({ parentName: f.parent, children: f.children, jj, signInUrl, payUrl, amountCents: payUrl ? f.owingCents : 0, needsWaiver: f.needsWaiver, email: f.email })
  return jjReminder({ parentName: f.parent, children: f.children, jj, url: payUrl || signInUrl, amountCents: payUrl ? f.owingCents : 0, needsWaiver: f.needsWaiver, email: f.email })
}

// Previews: the family asked for, else one that owes and one that does not.
export function invitePreviews(plan, config, { site, email = '' }) {
  const pick = email ? plan.list.filter((f) => f.email === email) : [plan.list.find((f) => f.owingCents > 0 && f.todo), plan.list.find((f) => !f.owingCents && f.todo)].filter(Boolean)
  return pick.map((f) => {
    const payUrl = plan.kind !== 'next' && f.owingCents > 0 ? `${site}/jfp-account/?pay=JJPAY-PREVIEW` : ''
    const built = buildFor(plan.kind, f, config, { site, payUrl })
    return { email: f.email, parent: f.parent, label: plan.kind === 'next' ? 'Next term' : f.owingCents > 0 ? `Owes ${(f.owingCents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}` : 'Nothing to pay', subject: built.subject, html: built.html }
  })
}

// One batch. Returns { sent, failed, skipped, remaining }.
export async function sendInvites(plan, config, principal, { emails = [], resend = false, site, filter = 'both' }) {
  if (plan.blocked) return { error: plan.blocked, status: 409 }
  const want = new Set(emails.map(validEmail).filter(Boolean))
  const eligible = (f) => want.has(f.email) && f.todo && (!f.sentAt || resend)
  const todo = plan.list.filter(eligible).slice(0, BATCH)
  const sent = [], failed = [], skipped = []
  const jj = config.juniors
  const table = tableFor(config, jj.term)
  for (const f of todo) {
    const lock = `jj:invite-lock:${plan.kind}:${f.email}`
    if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '600'])) !== 'OK') { skipped.push({ email: f.email, why: 'Sent in the last 10 minutes' }); continue }
    try {
      let payUrl = '', payreqId = ''
      const wantMoney = plan.kind === 'new' || (plan.kind === 'reminder' && filter !== 'waiver')
      if (plan.kind !== 'next' && wantMoney && !f.owingKnown) throw new Error('What this family owes could not be worked out (money could not be read). Try again in a minute.')
      if (plan.kind !== 'next' && wantMoney && f.owingCents > 0) {
        const rows = f.children.filter((c) => c.owingCents > 0).map((c) => ({ rowId: c.rowId, name: c.name, owingCents: c.owingCents }))
        const r = await ensureTermPayreq({ by: principal.email, email: f.email, parentName: f.parent, rows, amountCents: f.owingCents, term: jj.term, table, reason: plan.kind, site })
        if (r.busy) throw new Error('A payment from this family is going through on Stripe right now.')
        payreqId = r.payreq.id
        payUrl = jjPayreqUrl(site, r.payreq)
      }
      if (plan.kind === 'next') {
        const st = await jjNextStatuses(plan.next.name)
        for (const c of f.children) if (!['held', 'paid', 'no'].includes(st[c.rowId]?.status)) await setJJNextStatus(plan.next.name, c.rowId, { ...(st[c.rowId] || {}), status: 'invited', invitedBy: principal.email })
      }
      const built = buildFor(plan.kind, wantMoney ? f : { ...f, owingCents: 0 }, config, { site, payUrl })
      await sendJJFamilyEmail({ to: f.email, parentName: f.parent, built })
      const prev = (await readInvites())[`${plan.kind}:${f.email}`]
      await kvCommand(['HSET', INVITES, `${plan.kind}:${f.email}`, JSON.stringify({ at: new Date().toISOString(), by: principal.email, byName: principal.name, count: (prev?.count || 0) + 1, payreqId, amountCents: payUrl ? f.owingCents : 0, term: plan.kind === 'next' ? plan.next.name : jj.term, subject: built.subject })])
      sent.push(f.email)
    } catch (error) {
      console.error('jj invite failed', plan.kind, error.message)
      failed.push({ email: f.email, error: String(error.message || error).slice(0, 200) })
      await kvCommand(['DEL', lock]).catch(() => {})
    }
  }
  await audit({ by: principal.email, action: `jj.invite.${plan.kind}`, target: plan.kind === 'next' ? plan.next.name : jj.term, after: { sent: sent.length, failed: failed.length, skipped: skipped.length, families: sent } })
  const remaining = plan.list.filter((f) => eligible(f) && !sent.includes(f.email) && !failed.some((x) => x.email === f.email) && !skipped.some((x) => x.email === f.email)).length
  return { sent, failed, skipped, remaining }
}
