// One question at the end of term (Lee, 30 Oct 2026): "How likely are you to
// recommend JFP to a friend?" 0 to 10, an optional comment, and whether we
// may share it. Families answer in My account; Lee and Ligia see every answer
// on Program > Feedback, and each one comes to the JFP Telegram.
//
// config.feedback: { open, term, sentAt, sentBy, sentCount }. The question
// shows in My account only while open. The email to families goes only when
// Lee or Ligia press Send on the Feedback page, after reading its words.
// Answers: KV hash jfp:feedback:<term slug>, family email -> JSON.
import { kvCommand, getConfig, saveConfig, audit, clean, sydneyToday, dateLabel } from './_jfp-store.js'

export const QUESTION = 'How likely are you to recommend JFP to a friend?'
const slug = (term) => String(term || 'term').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
const keyFor = (term) => `jfp:feedback:${slug(term)}`
const TERMS = 'jfp:feedback:terms'
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const parse = (v) => { try { return JSON.parse(v) } catch { return null } }

// The shape lives in _jfp-store.js (normaliseConfig); this reads it safely.
export const feedbackConfig = (f) => ({ open: false, term: '', sentAt: '', sentBy: '', sentCount: 0, ...(f && typeof f === 'object' ? f : {}) })

export function band(score) { return score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor' }
// Net promoter score: % promoters less % detractors, -100 to 100.
export function npsOf(list) {
  if (!list.length) return null
  const p = list.filter((a) => a.score >= 9).length, d = list.filter((a) => a.score <= 6).length
  return Math.round(((p - d) * 100) / list.length)
}

async function answersFor(term) {
  const flat = (await kvCommand(['HGETALL', keyFor(term)])) || []
  const out = []
  for (let i = 0; i + 1 < flat.length; i += 2) { const v = parse(flat[i + 1]); if (v) out.push({ email: flat[i], ...v }) }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

// My account: is the question open for this family, and what they said.
export async function familyFeedback(email, config, { inTerm }) {
  const f = feedbackConfig(config.feedback)
  if (!f.open || !inTerm) return null
  const mine = parse(await kvCommand(['HGET', keyFor(f.term), email]))
  return { question: QUESTION, term: f.term, mine: mine ? { score: mine.score, comment: mine.comment || '', share: mine.share === true } : null }
}

export async function saveFamilyFeedback({ email, config, body, family, tell }) {
  const f = feedbackConfig(config.feedback)
  if (!f.open) return { error: 'The question is closed for now. Thank you.' }
  if (!family.inTerm) return { error: 'Only families training with us this term can answer.' }
  const score = Number(body.score)
  if (!Number.isInteger(score) || score < 0 || score > 10) return { error: 'Pick a number from 0 to 10.' }
  if ((await kvCommand(['SET', `jfp:rl:feedback:${email}`, '1', 'NX', 'EX', '20'])) !== 'OK') return { error: 'One moment, then try again.' }
  const key = keyFor(f.term)
  const before = parse(await kvCommand(['HGET', key, email]))
  const rec = { score, comment: clean(body.comment, 1000), share: body.share === true, parent: family.parentName || '', players: family.players.slice(0, 6), at: new Date().toISOString(), ...(before ? { firstAt: before.firstAt || before.at, changed: true } : {}) }
  await kvCommand(['HSET', key, email, JSON.stringify(rec)])
  await kvCommand(['SADD', TERMS, f.term])
  if (!before || before.score !== rec.score || before.comment !== rec.comment) {
    const who = `${rec.parent || email}${rec.players.length ? ` (${rec.players.join(', ')})` : ''}`
    const tag = score <= 6 ? 'LOW SCORE: ' : ''
    try { await tell(`${tag}JFP feedback ${score}/10 from ${who}${before ? `, changed from ${before.score}` : ''}${rec.comment ? `\n"${rec.comment}"` : ''}${rec.share ? '\nHappy for us to share it.' : ''}\nhttps://jonerfootball.com/jfp-portal/#feedback`) } catch (e) { console.error('jfp feedback telegram failed', e) }
  }
  return { saved: true, mine: { score: rec.score, comment: rec.comment, share: rec.share } }
}

// ---------- the email (Lee or Ligia press Send) ----------

export function surveyWords({ parentName = '', term = '' } = {}) {
  return {
    subject: `One quick question about JFP ${term}`.trim(),
    heading: 'How did we do this term?',
    paras: [
      `Hi ${firstName(parentName) || 'there'}. Thanks for being part of Joner Football Performance${term ? ` in ${term}` : ''}.`,
      `One quick question: ${QUESTION.charAt(0).toLowerCase()}${QUESTION.slice(1)} It takes 10 seconds, and you can add a comment if you want to.`,
      'Every answer comes straight to me, and we read every comment.',
      'Lee',
    ],
    cta: { label: 'Answer the question', url: 'https://jonerfootball.com/jfp-account/#feedback' },
  }
}

// Families training this term: one email each, both parents' addresses kept apart.
export function surveyRecipients(players, rowEmails) {
  const by = new Map()
  for (const r of players) {
    if (!r.holdsPlace) continue
    for (const e of rowEmails(r)) {
      if (!e || /@jonerfootball\.com$/i.test(e)) continue
      const x = by.get(e) || { email: e, parentName: r.ownContact ? r.player : r.parent || '', players: [] }
      if (!x.players.includes(r.player)) x.players.push(r.player)
      by.set(e, x)
    }
  }
  return [...by.values()]
}

export async function sendSurvey({ principal, config, recipients, send }) {
  const f = feedbackConfig(config.feedback)
  if (f.sentAt && f.term === config.term) return { error: `Already sent for ${f.term} on ${dateLabel(f.sentAt.slice(0, 10))}.` }
  if (!recipients.length) return { error: 'No families to send to.' }
  if ((await kvCommand(['SET', 'jfp:feedback:sending', '1', 'NX', 'EX', '900'])) !== 'OK') return { error: 'It is sending already.' }
  // Open first, so a family who taps the button straight away can answer.
  await saveConfig({ feedback: { open: true, term: config.term, sentAt: new Date().toISOString(), sentBy: principal.email, sentCount: 0 } })
  let sent = 0
  const failed = []
  for (const r of recipients) {
    try { const out = await send({ to: r.email, name: r.parentName, ...surveyWords({ parentName: r.parentName, term: config.term }), kind: 'feedback question', replyTo: 'leejones@jonerfootball.com' }); if (out?.held) failed.push(`${r.email} (held)`); else sent += 1 } catch (e) { failed.push(r.email); console.error('jfp feedback email failed', r.email, e.message) }
  }
  const now = await getConfig()
  await saveConfig({ feedback: { ...feedbackConfig(now.feedback), sentCount: sent } })
  await kvCommand(['DEL', 'jfp:feedback:sending'])
  await audit({ by: principal.email, action: 'feedback.send', target: config.term, after: { sent, failed: failed.length } })
  return { sent, failed }
}

// ---------- the portal page ----------

export async function feedbackPage(config, { term } = {}) {
  const f = feedbackConfig(config.feedback)
  const terms = ((await kvCommand(['SMEMBERS', TERMS])) || []).filter(Boolean)
  const show = term && terms.includes(term) ? term : f.term || config.term
  const answers = await answersFor(show)
  const count = (b) => answers.filter((a) => band(a.score) === b).length
  return {
    feedback: { ...f, currentTerm: config.term, today: sydneyToday() },
    term: show, terms: [...new Set([config.term, ...terms])],
    nps: npsOf(answers), totals: { answers: answers.length, promoter: count('promoter'), passive: count('passive'), detractor: count('detractor') },
    answers: answers.map((a) => ({ email: a.email, parent: a.parent, players: a.players || [], score: a.score, band: band(a.score), comment: a.comment || '', share: a.share === true, at: a.at, changed: a.changed === true })),
    words: surveyWords({ parentName: 'Sam', term: config.term }),
    question: QUESTION,
  }
}

export async function setFeedbackOpen({ principal, config, open }) {
  const f = feedbackConfig(config.feedback)
  await saveConfig({ feedback: { ...f, open, term: f.term || config.term } })
  await audit({ by: principal.email, action: open ? 'feedback.open' : 'feedback.close', target: f.term || config.term })
  return { open }
}
