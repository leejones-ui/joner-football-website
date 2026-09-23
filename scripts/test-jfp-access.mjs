import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReadJfpFinance, coachHoursView } from '../api/_jfp-access.js';

test('financial access denies unauthenticated, inactive and coach principals', () => {
  for (const principal of [null, {}, {role:'owner'}, {verified:true,active:false,role:'owner'}, {verified:true,active:true,role:'coach'}]) {
    assert.equal(canReadJfpFinance(principal), false);
  }
  for (const role of ['owner','finance-admin']) assert.equal(canReadJfpFinance({verified:true,active:true,role}), true);
});
test('coach response isolates ownership and excludes financial/player fields', () => {
  const result=coachHoursView({verified:true,active:true,role:'coach',coachId:'coach-a'}, [
    {id:'a',coachId:'coach-a',scheduledMinutes:60,playerName:'PRIVATE',revenue:85000,notes:'PRIVATE'},
    {id:'b',coachId:'coach-b',scheduledMinutes:60},
  ]);
  assert.equal(result.length,1);
  assert.equal(result[0].id,'a');
  assert.equal(result[0].approvedWorkedMinutes,null);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.ok(!('revenue' in result[0]));
});
test('missing coach identity and inactive access fail closed', () => {
  for(const principal of [null,{verified:true,active:true,role:'coach'},{verified:true,active:false,role:'coach',coachId:'a'}]) {
    assert.throws(()=>coachHoursView(principal,[]),/Forbidden/);
  }
});
