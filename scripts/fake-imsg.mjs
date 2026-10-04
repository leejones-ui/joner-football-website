#!/usr/bin/env node
// A stand-in for imsg in tests: never sends anything. Keeps "Messages" in a
// JSON file (FAKE_IMSG_DB). FAKE_IMSG_MODE: ok (default), fail (exit 1, not
// stored), lost (exit 0 but never appears in Messages).
import fs from 'node:fs'
const db = process.env.FAKE_IMSG_DB || '/tmp/fake-imsg.json'
const mode = process.env.FAKE_IMSG_MODE || 'ok'
const state = fs.existsSync(db) ? JSON.parse(fs.readFileSync(db, 'utf8')) : { chats: [], msgs: [] }
const a = process.argv.slice(2)
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : '' }
const SENDER = '+61400000999'
if (a[0] === '--version') { console.log('imsg 0.14.1 (fake)'); process.exit(0) }
if (a[0] === 'chats') { for (const c of state.chats) console.log(JSON.stringify(c)); process.exit(0) }
if (a[0] === 'history') { for (const m of state.msgs.filter((x) => String(x.chat_id) === opt('--chat-id')).reverse()) console.log(JSON.stringify(m)); process.exit(0) }
if (a[0] === 'send') {
  if (mode === 'fail') { console.error('send failed'); process.exit(1) }
  const to = opt('--to')
  let chat = state.chats.find((c) => c.identifier === to)
  if (!chat) { chat = { id: state.chats.length + 1, identifier: to, participants: [to], is_group: false, service: to.endsWith('5') ? 'SMS' : 'iMessage', account_login: SENDER }; state.chats.push(chat) }
  if (mode !== 'lost') state.msgs.push({ id: state.msgs.length + 1, chat_id: chat.id, is_from_me: true, text: opt('--text'), created_at: new Date().toISOString(), destination_caller_id: SENDER, guid: `G-${state.msgs.length + 1}` })
  state.sends = (state.sends || 0) + 1
  fs.writeFileSync(db, JSON.stringify(state))
  console.log(JSON.stringify({ status: 'sent' }))
  process.exit(0)
}
process.exit(2)
