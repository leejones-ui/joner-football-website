// The Hermes request in progress, if any (Lee, 16 Oct 2026: Hermes on his
// phone gets full portal access). No imports, so the store, the email sender
// and the handlers can all read it without import cycles.
import { AsyncLocalStorage } from 'node:async_hooks'

export const agentContext = new AsyncLocalStorage()
export const AGENT_HEADER = 'x-jfp-agent-key'
export const CONFIRM_HEADER = 'x-jfp-confirmed'
export const CONFIRM_VALUE = 'lee-said-yes'
export const AGENT_NAME = 'Hermes for Lee'

// { agent: true, valid, confirmed, held: [] } inside a Hermes request.
export function agentNow() { return agentContext.getStore() || null }
export function isAgentRequest(req) { return Boolean(req?.headers?.[AGENT_HEADER]) }
