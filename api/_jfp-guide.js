// Who gets the account guide (Lee, 16 Oct 2026): "every single player that's
// in our program, plus all the new inquiries lately and people that have
// created an account". One entry per email, Term 4 first, then requests, then
// accounts. Built fresh at prepare and again at send, so the to-do box and any
// amount are what the records say at that moment.
//   term      a family holding a Term 4 place (familyPlan)
//   enquiry   a request on the booking page in the last ENQUIRY_DAYS, not in Term 4
//   account   an account made by someone new to us, not in either of the above
import { listApplications, normName, ageOn, sydneyToday } from './_jfp-store.js'
import { allAccounts } from './_jfp-account-open.js'
import { allProfiles, pickProfile } from './_jfp-profiles.js'
import { familyPlan } from './jfp-portal-data.js'

export const GUIDE = 'guide'
export const GUIDE_GROUPS = ['term', 'enquiry', 'account']
export const ENQUIRY_DAYS = 60
const NOT_PLAYING = ['Not playing club football', 'School or social only']

// What a player's profile is missing, in plain words.
export function missingOf(prof) {
  if (!prof) return ['every detail (nothing saved yet)']
  const out = []
  if (!prof.dob) out.push('date of birth')
  if (!prof.club && !NOT_PLAYING.includes(prof.level)) out.push('club')
  if (!(prof.positions || []).length) out.push('positions')
  if (!prof.foot) out.push('strongest foot')
  if (!String(prof.goals || '').trim()) out.push('what they want to work on')
  if (!prof.emergencyName || !prof.emergencyPhone) out.push('emergency contact')
  return out
}

export async function guideAudience(req, config, { groups = GUIDE_GROUPS } = {}) {
  const [plan, apps, accounts, profiles] = await Promise.all([familyPlan(req, config), listApplications(), allAccounts(), allProfiles().catch(() => [])])
  const byEmail = (email) => profiles.filter((p) => (p.emails || []).includes(email))
  const out = new Map()
  if (groups.includes('term')) {
    for (const f of plan.list) {
      const profs = byEmail(f.email)
      out.set(f.email, {
        group: 'term', email: f.email, parent: f.parent, self: f.self === true, owingCents: f.owingCents, needsWaiver: f.needsWaiver,
        players: f.players.map((x) => ({ rowId: x.rowId, name: x.name, group: x.group, missing: missingOf(pickProfile(profiles, { key: normName(x.name), rowIds: [x.rowId] }) || pickProfile(profs, { key: normName(x.name) })) })),
        rowIds: f.players.map((x) => x.rowId),
      })
    }
  }
  const termEmails = new Set(plan.list.map((f) => f.email))
  const since = Date.now() - ENQUIRY_DAYS * 86400000
  if (groups.includes('enquiry')) {
    for (const a of apps.filter((x) => Date.parse(x.createdAt) > since).sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))) {
      const email = String(a.email || '').toLowerCase()
      if (!email || termEmails.has(email) || out.has(email)) continue
      const profs = byEmail(email)
      out.set(email, {
        group: 'enquiry', email, parent: a.parentName || '', mobile: a.mobile || '', self: false, owingCents: 0, needsWaiver: false, requestId: a.id, status: a.status,
        players: (a.players || []).map((x) => ({ name: x.name, group: '', missing: missingOf(pickProfile(profs, { key: normName(x.name) })) })), rowIds: [],
      })
    }
  }
  if (groups.includes('account')) {
    for (const acct of Object.values(accounts).filter((x) => x.kind === 'new')) {
      const email = acct.email
      if (termEmails.has(email) || out.has(email)) continue
      const profs = byEmail(email)
      const selfKeys = new Set((acct.players || []).filter((x) => x.self).map((x) => x.key))
      out.set(email, {
        group: 'account', email, parent: profs.find((p) => p.parentName)?.parentName || '', self: profs.length > 0 && profs.every((p) => selfKeys.has(p.key)), owingCents: 0, needsWaiver: false, accountEmail: email,
        players: profs.map((p) => ({ name: p.name, group: '', missing: missingOf(p), age: p.dob ? ageOn(p.dob, sydneyToday()) : null })), rowIds: [],
      })
    }
  }
  return { list: [...out.values()], noEmail: groups.includes('term') ? plan.noEmail : [], profiles }
}

// The mobile for a guide text that has no Term 4 row: the request's, or the
// account's profile (parent's mobile, or the player's own for an adult).
export function guidePhoneRaw(r, profiles = []) {
  if (r.mobile) return r.mobile
  const profs = profiles.filter((p) => (p.emails || []).includes(r.email))
  return profs.find((p) => p.parentMobile)?.parentMobile || ''
}
