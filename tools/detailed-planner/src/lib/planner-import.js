import { LIMITS, sanitizePlan } from './plan-schema.js'

// A file must be structurally safe before it replaces the coach's open work.
export function readImportedPlan(value) {
  if (!value || typeof value !== 'object' || typeof value.title !== 'string' || !Array.isArray(value.scenes) || !value.scenes.length) throw Error('That file is not a valid session plan.')
  if (JSON.stringify(value).length > LIMITS.bytes) throw Error('This session file is too large.')
  for (const scene of value.scenes) {
    if (!scene || typeof scene !== 'object' || !Array.isArray(scene.objects) || !Array.isArray(scene.drawings)) throw Error('Every scene needs objects and drawings. Your current session has been kept.')
    if (scene.objects.length > LIMITS.objects || scene.drawings.length > LIMITS.drawings || [...scene.objects,...scene.drawings].some(item=>!item || typeof item!=='object' || Array.isArray(item))) throw Error('This file contains an invalid scene.')
  }
  const checked=sanitizePlan(value)
  if(!checked.ok)throw Error(checked.error)
  return checked.plan
}
