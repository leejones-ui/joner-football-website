// Makes Hermes's JFP portal key (Lee, 16 Oct 2026). Run on the Mac mini with
// the production KV env loaded. The key goes to ~/.jfp-agent/hermes.key
// (only this Mac user can read it); only its hash goes to KV. Running it again
// replaces the key, so the old one stops working at once.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setAgentKey } from '../api/_jfp-agent.js'

const file = process.env.JFP_AGENT_KEY_FILE || path.join(os.homedir(), '.jfp-agent', 'hermes.key')
const key = `jfpa_${crypto.randomBytes(32).toString('base64url')}`
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
await setAgentKey(key)
fs.writeFileSync(file, `${key}\n`, { mode: 0o600 })
fs.chmodSync(file, 0o600)
console.log(`Hermes key saved to ${file} and switched on.`)
