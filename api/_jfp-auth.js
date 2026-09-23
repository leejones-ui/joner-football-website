import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const COOKIE = '__Host-jfp_staff';
export const SESSION_SECONDS = 8 * 60 * 60;
export const digest = value => createHash('sha256').update(value).digest('hex');
const sessionKey = token => `jfp:auth:session:${digest(token)}`;
export const normaliseUsername = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Use a password of at least 12 characters');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function passwordValid(password, encoded) {
  if (typeof password !== 'string' || password.length > 256 || typeof encoded !== 'string') return false;
  const parts = encoded.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const candidate = await scrypt(password, parts[1], 64);
  return timingSafeEqual(candidate, Buffer.from(parts[2], 'hex'));
}
export function cookieHeader(token, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function cookieToken(req) {
  return String(req.headers?.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1) || '';
}
export function sameOrigin(req, expectedOrigin) {
  if (!expectedOrigin) return false;
  try { return new URL(req.headers?.origin).origin === new URL(expectedOrigin).origin; } catch { return false; }
}
export function createAuthStore(kv, now = () => Date.now()) {
  const get = async key => { const raw=await kv(['GET',key]); return raw ? JSON.parse(raw) : null; };
  return {
    async login(username, password, ip) {
      username = normaliseUsername(username);
      if (!username || username.length>200) return null;
      // Atomic persistent buckets, shared by all function instances. Storage errors fail closed.
      for (const scope of [`user:${digest(username)}`, `ip:${digest(String(ip))}`]) {
        const allowed=await kv(['EVAL',"local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",1,`jfp:auth:limit:${scope}`,900]);
        if(Number(allowed)>10) throw new Error('Rate limited');
      }
      const user=await get(`jfp:auth:user:${digest(username)}`);
      // Valid dummy hash keeps the missing-user path on the password hashing path.
      const dummy=`scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
      const matches=await passwordValid(password,user?.passwordHash || dummy);
      if(!matches || user?.active!==true || !['owner','finance-admin','coach'].includes(user.role)) return null;
      if(user.role==='coach' && !user.coachId) return null;
      await kv(['DEL',`jfp:auth:limit:user:${digest(username)}`]);
      return { username, user };
    },
    async openSession(username, user) {
      const token=randomBytes(32).toString('hex');
      await kv(['SET',sessionKey(token),JSON.stringify({username,version:user.sessionVersion,expiresAt:now()+SESSION_SECONDS*1000}),'EX',SESSION_SECONDS]);
      return token;
    },
    async principal(token) {
      if(!/^[a-f0-9]{64}$/.test(token)) return null;
      const session=await get(sessionKey(token));
      if(!session || session.expiresAt<=now()) return null;
      const user=await get(`jfp:auth:user:${digest(session.username)}`);
      if(!user || user.active!==true || user.sessionVersion!==session.version || !['owner','finance-admin','coach'].includes(user.role)) return null;
      if(user.role==='coach' && !user.coachId) return null;
      return {verified:true,active:true,id:user.id,name:user.name,email:session.username,role:user.role,coachId:user.coachId};
    },
    async logout(token) { if(/^[a-f0-9]{64}$/.test(token)) await kv(['DEL',sessionKey(token)]); },
  };
}
