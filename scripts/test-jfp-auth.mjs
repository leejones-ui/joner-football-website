import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {passwordHash,passwordValid,createAuthStore,cookieHeader,sameOrigin} from '../api/_jfp-auth.js';
const digest=s=>createHash('sha256').update(s).digest('hex');
test('passwords are salted and verified without storing plaintext',async()=>{
 const password='test-only-long-password'; const a=await passwordHash(password),b=await passwordHash(password);
 assert.notEqual(a,b);assert.equal(await passwordValid(password,a),true);assert.equal(await passwordValid('wrong',a),false);assert.equal(await passwordValid(password,'broken'),false);
 await assert.rejects(()=>passwordHash('short'));
});
test('sessions revoke immediately when account disabled or logged out',async()=>{
 const db=new Map(); const kv=async([cmd,key,value])=>{if(cmd==='GET')return db.get(key);if(cmd==='SET'){db.set(key,value);return 'OK';}if(cmd==='DEL'){db.delete(key);return 1;}if(cmd==='EVAL')return 1;throw Error('Unexpected');};
 const key=`jfp:auth:user:${digest('coach@example.test')}`;
 const user={id:'a',name:'Coach',active:true,role:'coach',coachId:'a',sessionVersion:1,passwordHash:await passwordHash('test-only-long-password')};
 db.set(key,JSON.stringify(user)); const auth=createAuthStore(kv);
 assert.equal(await auth.login('coach@example.test','wrong','test'),null);
 const ok=await auth.login('coach@example.test','test-only-long-password','test');
 assert.equal(ok.user.coachId,'a');
 const token=await auth.openSession(ok.username,ok.user);
 assert.equal((await auth.principal(token)).coachId,'a');
 db.set(key,JSON.stringify({...user,active:false}));assert.equal(await auth.principal(token),null);
 db.set(key,JSON.stringify(user));await auth.logout(token);assert.equal(await auth.principal(token),null);
});
test('persistent throttle and unavailable storage deny login',async()=>{
 await assert.rejects(()=>createAuthStore(async()=>11).login('u','password','ip'),/Rate limited/);
 await assert.rejects(()=>createAuthStore(async()=>{throw Error('offline');}).login('u','password','ip'),/offline/);
});
test('cookies and cross-site request protections',()=>{
 const cookie=cookieHeader('example');for(const flag of ['__Host-','HttpOnly','Secure','SameSite=Strict','Path=/'])assert.ok(cookie.includes(flag));
 assert.equal(sameOrigin({headers:{origin:'https://evil.test'}},'https://jonerfootball.com'),false);
 assert.equal(sameOrigin({headers:{}},'https://jonerfootball.com'),false);
 assert.equal(sameOrigin({headers:{origin:'https://jonerfootball.com'}},'https://jonerfootball.com'),true);
});
