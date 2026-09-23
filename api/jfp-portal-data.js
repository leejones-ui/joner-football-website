// Everything the JFP portal shows, behind a signed-in staff session.
//
// Roles are enforced here, on the server, per action:
//   owner          everything, including staff accounts and settings
//   finance-admin  everything except staff accounts and prices (Ligia)
//   coach          only their own groups, their players' names and their hours
import crypto from 'node:crypto'
import { cookieToken, sameOrigin } from './_jfp-auth.js'
import { auth, listUsers, createInvite, setActive, ROLES } from './_jfp-accounts.js'
import { siteUrl } from './_holiday-store.js'
import {
  getConfig, saveConfig, listGroups, getGroup, saveGroup, validateGroup, onlineCounts, placesLeft, listBookings, getBooking,
  saveBooking, releasePlaces, listApplications, getApplication, saveApplication, coachById, coachByAirtableName, sessionDates,
  dateLabel, formatAud, to24h, clean,
} from './_jfp-store.js'
import { readTerm4WithCoaches, airtableCounts, draftGroupsFromRoster } from './_jfp-airtable.js'
import { repairJfpBooking, effectsSummary } from './_jfp-finalise.js'
import { sendInvite, sendApplicationApproved } from './_jfp-email.js'

const FINANCE = new Set(['owner', 'finance-admin'])
function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error) { return res.status(status).json({ success: false, error }) }
const aud = (n) => (typeof n === 'number' ? Math.round(n * 100) : 0)

async function groupsWithCounts(config) {
  const [groups, { counts, at }] = await Promise.all([listGroups(), airtableCounts({ fresh: true })])
  const online = await onlineCounts(groups.map((g) => g.id))
  return {
    at,
    groups: groups.map((g) => ({
      ...g,
      coachName: coachById(config, g.coachId)?.name || '',
      extraCoachNames: (g.extraCoachIds || []).map((c) => coachById(config, c)?.name).filter(Boolean),
      existingPlayers: counts[g.id] || 0,
      onlinePlayers: online[g.id] || 0,
      placesLeft: placesLeft(g, counts[g.id], online[g.id]),
      firstDate: dateLabel(sessionDates(config, g.day)[0]),
      sortTime: to24h(g.time),
    })),
  }
}

function ageFromNotes(notes) { const m = /age (\d{1,2})/i.exec(notes || ''); return m ? Number(m[1]) : null }

async function finance(config, roster, bookings) {
  const holding = roster.filter((r) => r.holdsPlace)
  const sum = (list, k) => list.reduce((t, r) => t + aud(r[k]), 0)
  const byStatus = {}
  for (const r of holding) byStatus[r.paymentStatus || 'Not set'] = (byStatus[r.paymentStatus || 'Not set'] || 0) + 1
  const paidOnline = bookings.filter((b) => b.status === 'paid')
  const gross = paidOnline.reduce((t, b) => t + (b.amountPaidCents || 0), 0)
  const feesKnown = paidOnline.filter((b) => b.stripeFeeCents != null)
  const fees = feesKnown.reduce((t, b) => t + b.stripeFeeCents, 0)
  const outstanding = holding.filter((r) => (r.balanceAud || 0) > 0)
  return {
    airtable: {
      label: 'Recorded in Airtable Term 4 Players',
      players: holding.length,
      feesCents: sum(holding, 'feeAud'),
      paidCents: sum(holding, 'paidAud'),
      outstandingCents: sum(holding, 'balanceAud'),
      outstandingPlayers: outstanding.length,
      byStatus,
      note: 'Sibling and two-session families can have one payment split across rows. Totals are as Airtable records them.',
    },
    online: {
      label: 'Paid online through the booking page',
      bookings: paidOnline.length,
      players: paidOnline.reduce((t, b) => t + (b.players?.length || 0), 0),
      grossCents: gross,
      stripeFeesCents: fees,
      netCents: gross - fees,
      feesPending: paidOnline.length - feesKnown.length,
      note: 'Exact Stripe fees from each balance transaction. Net collected is not profit and is not the bank payout.',
    },
    outstanding: outstanding.map((r) => ({ player: r.player, parent: r.parent, group: `${r.day} ${r.time} ${r.location}`, balanceCents: aud(r.balanceAud), status: r.paymentStatus })).sort((a, b) => b.balanceCents - a.balanceCents),
  }
}

function coachGroupsView(principal, config, groups, roster) {
  const mine = groups.filter((g) => g.coachId === principal.coachId || (g.extraCoachIds || []).includes(principal.coachId))
  const me = coachById(config, principal.coachId)
  return mine.map((g) => {
    const players = roster
      .filter((r) => r.groupId === g.id && r.holdsPlace && (coachByAirtableName(config, r.coach)?.id === principal.coachId || (!r.coach && g.coachId === principal.coachId)))
      .map((r) => ({ name: r.player, age: ageFromNotes(r.notes) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const dates = sessionDates(config, g.day)
    return {
      id: g.id, day: g.day, time: g.time, sortTime: to24h(g.time), location: g.location, programme: g.programme,
      durationMin: g.durationMin, players, dates: dates.map(dateLabel),
      scheduledMinutesPerWeek: g.durationMin, scheduledMinutesTerm: g.durationMin * dates.length,
      coachName: me?.name || '',
    }
  })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (process.env.JFP_PORTAL_ENABLED !== 'true') return fail(res, 503, 'The JFP portal is not open yet.')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  if (!sameOrigin(req, process.env.JFP_PORTAL_ORIGIN)) return fail(res, 403, 'Invalid request origin')
  const principal = await auth.principal(cookieToken(req))
  if (!principal) return fail(res, 401, 'Please sign in.')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  const action = clean(body.action, 40)
  const isFinance = FINANCE.has(principal.role)
  const isOwner = principal.role === 'owner'

  try {
    const config = await getConfig()

    // ---------- coach ----------
    if (action === 'myGroups') {
      if (principal.role !== 'coach' && !isFinance) return fail(res, 403, 'Not allowed.')
      const coachId = principal.role === 'coach' ? principal.coachId : clean(body.coachId, 30)
      const [groups, roster] = await Promise.all([listGroups(), readTerm4WithCoaches()])
      const view = coachGroupsView({ ...principal, coachId }, config, groups, roster)
      const perWeek = view.reduce((t, g) => t + g.scheduledMinutesPerWeek, 0)
      return res.status(200).json({ success: true, coach: coachById(config, coachId)?.name || '', term: config.term, groups: view, hours: { perWeekMinutes: perWeek, termMinutes: perWeek * config.weeks, weeks: config.weeks } })
    }

    if (!isFinance) return fail(res, 403, 'Not allowed.')

    // ---------- Lee and Ligia ----------
    switch (action) {
      case 'overview': {
        const [{ groups, at }, roster, bookings, applications] = await Promise.all([groupsWithCounts(config), readTerm4WithCoaches(), listBookings(), listApplications()])
        const fin = await finance(config, roster, bookings)
        return res.status(200).json({
          success: true,
          term: config.term,
          termStart: dateLabel(sessionDates(config, 'Monday')[0]),
          syncedAt: at,
          totals: {
            players: roster.filter((r) => r.holdsPlace).length,
            groups: groups.length,
            openGroups: groups.filter((g) => g.mode === 'direct').length,
            placesLeft: groups.filter((g) => g.mode === 'direct').reduce((t, g) => t + g.placesLeft, 0),
            pendingApplications: applications.filter((a) => a.status === 'pending').length,
            onlineBookings: bookings.filter((b) => b.status === 'paid').length,
            needsAttention: bookings.filter((b) => b.status === 'paid' && !effectsSummary(b).ok).length,
          },
          finance: fin,
          coaches: config.coaches.map((c) => ({ id: c.id, name: c.name })),
          groups,
        })
      }

      case 'groups':
        return res.status(200).json({ success: true, ...(await groupsWithCounts(config)), coaches: config.coaches.map((c) => ({ id: c.id, name: c.name })) })

      case 'updateGroup': {
        const existing = await getGroup(body.id)
        if (!existing) return fail(res, 404, 'Group not found.')
        const allowed = ['capacity', 'mode', 'coachId', 'durationMin', 'publicNote', 'programme']
        const patch = Object.fromEntries(Object.entries(body.group || {}).filter(([k]) => allowed.includes(k)))
        if ('capacity' in patch) patch.capacity = Number(patch.capacity)
        if ('durationMin' in patch) patch.durationMin = Number(patch.durationMin)
        const v = validateGroup(patch, config, existing)
        if (!v.ok) return fail(res, 400, v.errors.join(' '))
        return res.status(200).json({ success: true, group: await saveGroup({ ...existing, ...v.group }) })
      }

      case 'syncGroups': {
        // Adds any day/time/location in Term 4 that is not a group yet. Never
        // changes a group staff have already set up.
        const roster = await readTerm4WithCoaches()
        const existing = new Set((await listGroups()).map((g) => g.id))
        const draft = draftGroupsFromRoster(roster, config)
        let added = 0
        for (const d of draft) {
          if (existing.has(d.id)) continue
          const v = validateGroup(d, config)
          if (v.ok) { await saveGroup({ ...v.group, extraCoachIds: d.extraCoachIds, createdFrom: 'airtable' }); added += 1 }
        }
        return res.status(200).json({ success: true, added, total: existing.size + added })
      }

      case 'roster': {
        const roster = await readTerm4WithCoaches()
        const gid = clean(body.groupId, 80)
        const rows = roster.filter((r) => r.holdsPlace && (!gid || r.groupId === gid)).map((r) => ({
          id: r.id, player: r.player, parent: r.parent, email: r.email, phone: r.phone, day: r.day, time: r.time, location: r.location,
          groupId: r.groupId, coach: r.coach, confirmation: r.confirmation, paymentStatus: r.paymentStatus, paymentType: r.paymentType,
          feeCents: aud(r.feeAud), paidCents: aud(r.paidAud), balanceCents: aud(r.balanceAud), online: Boolean(r.onlineBookingId),
          sortTime: to24h(r.time),
        }))
        return res.status(200).json({ success: true, rows })
      }

      case 'bookings': {
        const list = (await listBookings()).filter((b) => b.status !== 'reserving')
        return res.status(200).json({
          success: true,
          bookings: list.map((b) => ({
            id: b.id, status: b.status, source: b.source || 'direct', createdAt: b.createdAt, paidAt: b.paidAt || '',
            group: b.groupSnapshot ? `${b.groupSnapshot.day} ${b.groupSnapshot.time}, ${b.groupSnapshot.location}` : b.groupId,
            players: b.players || [], parentName: b.parentName || '', email: b.email || '', mobile: b.mobile || '',
            amountCents: b.amountPaidCents ?? b.priceCents ?? 0, stripeFeeCents: b.stripeFeeCents ?? null,
            stripeUrl: b.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${b.stripePaymentIntentId}` : '',
            effects: b.status === 'paid' ? effectsSummary(b) : null, effectDetail: b.effects || {}, needsAttention: b.needsAttention || '',
          })),
        })
      }

      case 'repairBooking': {
        const r = await repairJfpBooking(clean(body.bookingId, 60))
        return r.ok ? res.status(200).json({ success: true, summary: r.summary }) : fail(res, 400, 'Only paid bookings can be repaired.')
      }

      case 'cancelBooking': {
        // Frees the place. A paid booking also needs its Airtable row marked and
        // a refund in Stripe; both are staff decisions, flagged here.
        const b = await getBooking(clean(body.bookingId, 60))
        if (!b) return fail(res, 404, 'Booking not found.')
        await releasePlaces(b.groupId, b.id, b.players?.length || b.seats || 1)
        await saveBooking({ ...b, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: principal.email })
        return res.status(200).json({ success: true, wasPaid: b.status === 'paid', stripeUrl: b.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${b.stripePaymentIntentId}` : '' })
      }

      case 'applications': {
        const [apps, groups] = await Promise.all([listApplications(), listGroups()])
        const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
        return res.status(200).json({ success: true, applications: apps.map((a) => ({ ...a, payToken: undefined, group: byId[a.groupId] ? `${byId[a.groupId].day} ${byId[a.groupId].time}, ${byId[a.groupId].location}` : a.groupId, programme: byId[a.groupId]?.programme || '' })) })
      }

      case 'decideApplication': {
        const app = await getApplication(clean(body.id, 60))
        if (!app) return fail(res, 404, 'Application not found.')
        if (app.status !== 'pending') return fail(res, 409, `Already ${app.status}.`)
        if (body.decision === 'reject') {
          await saveApplication({ ...app, status: 'rejected', decidedBy: principal.email, decidedAt: new Date().toISOString(), decisionNote: clean(body.note, 300) })
          return res.status(200).json({ success: true, status: 'rejected' })
        }
        if (body.decision !== 'approve') return fail(res, 400, 'Choose approve or reject.')
        const group = await getGroup(app.groupId)
        if (!group) return fail(res, 404, 'That group no longer exists.')
        const payToken = crypto.randomBytes(24).toString('hex')
        const next = { ...app, status: 'approved', payToken, payTokenExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), decidedBy: principal.email, decidedAt: new Date().toISOString() }
        await saveApplication(next)
        const payUrl = `${siteUrl(req)}/jfp-booking/?approved=${encodeURIComponent(app.id)}&token=${payToken}`
        await sendApplicationApproved({ application: next, group, config, payUrl })
        return res.status(200).json({ success: true, status: 'approved' })
      }

      case 'finance': {
        const [roster, bookings] = await Promise.all([readTerm4WithCoaches(), listBookings()])
        return res.status(200).json({ success: true, finance: await finance(config, roster, bookings) })
      }

      case 'getConfig':
        return res.status(200).json({ success: true, config, canEditPrice: isOwner })

      case 'saveConfig': {
        const patch = {}
        if ('waiverUrl' in (body.config || {})) patch.waiverUrl = String(body.config.waiverUrl || '')
        if ('staffEmails' in (body.config || {})) patch.staffEmails = body.config.staffEmails
        if (Array.isArray(body.config?.coachEmails)) {
          const emails = Object.fromEntries(body.config.coachEmails.map((c) => [c.id, c.email]))
          patch.coaches = config.coaches.map((c) => ({ ...c, email: c.id in emails ? emails[c.id] : c.email }))
        }
        if (isOwner && 'priceCents' in (body.config || {})) patch.priceCents = Number(body.config.priceCents)
        return res.status(200).json({ success: true, config: await saveConfig(patch) })
      }

      case 'users':
        if (!isOwner) return fail(res, 403, 'Only Lee can manage logins.')
        return res.status(200).json({ success: true, users: await listUsers(), roles: ROLES, coaches: config.coaches.map((c) => ({ id: c.id, name: c.name, email: c.email })) })

      case 'invite': {
        if (!isOwner) return fail(res, 403, 'Only Lee can manage logins.')
        const inv = await createInvite(body.user || {}, principal.email)
        if (inv.error) return fail(res, 400, inv.error)
        await sendInvite({ email: inv.email, name: inv.name, role: inv.role, url: `${siteUrl(req)}/jfp-portal/?setup=${inv.token}` })
        return res.status(200).json({ success: true, email: inv.email })
      }

      case 'setActive': {
        if (!isOwner) return fail(res, 403, 'Only Lee can manage logins.')
        if (clean(body.email, 200).toLowerCase() === principal.email) return fail(res, 400, 'You cannot switch off your own login.')
        const u = await setActive(clean(body.email, 200), body.active === true)
        return u ? res.status(200).json({ success: true, active: u.active }) : fail(res, 404, 'Login not found.')
      }

      default:
        return fail(res, 400, `Unknown action: ${action || '(none)'}`)
    }
  } catch (error) {
    console.error(`jfp-portal-data ${action} failed`, error)
    return fail(res, 500, error.message || 'Something went wrong.')
  }
}

export { formatAud }
