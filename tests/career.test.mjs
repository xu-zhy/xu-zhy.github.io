import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createVault, openVault, encrypt, validateEnvelope, validateData} from '../assets/js/career/vault.mjs';
import {filtered, inRange, validateTask, localDate} from '../assets/js/career/model.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('encrypted round trip, wrong password, tampering and unique IVs', async () => {
  const vault = await createVault('a strong test password');
  vault.data.tasks.push({id:'1',title:'私人任务',status:'进行中',notes:'sensitive interview notes'});
  const first = await encrypt(vault.data,vault.key,vault.salt);
  const second = await encrypt(vault.data,vault.key,vault.salt);
  assert.notEqual(first.iv,second.iv);
  assert.ok(!JSON.stringify(first).includes('sensitive'));
  assert.ok(!JSON.stringify(first).includes('私人'));
  assert.equal(vault.key.extractable,false);
  assert.deepEqual((await openVault(first,'a strong test password')).data,vault.data);
  await assert.rejects(openVault(first,'wrong password'));
  const tampered = {...first,data:(first.data[0] === 'A' ? 'B' : 'A')+first.data.slice(1)};
  await assert.rejects(openVault(tampered,'a strong test password'));
  await assert.rejects(openVault({...first,iv:second.iv},'a strong test password'));
});
test('reject invalid backup versions and record structures', () => {
  assert.throws(() => validateEnvelope({format:'career-os',version:2}));
  assert.throws(() => validateData({version:1,tasks:[{id:'1',title:{bad:true}}],jobs:[],knowledge:[]}));
  assert.throws(() => validateData({version:1,tasks:[{id:'1'},{id:'1'}],jobs:[],knowledge:[]}));
});
test('date filters respect Monday week, local dates and completion', () => {
  const today = '2026-11-11';
  assert.equal(localDate(new Date(2026,10,11,1)),today);
  assert.ok(inRange({due:'2026-11-09'},'week',today));
  assert.ok(inRange({due:'2026-11-15'},'week',today));
  assert.ok(!inRange({due:'2026-11-08'},'week',today));
  assert.ok(inRange({due:'2026-11-10',status:'进行中'},'overdue',today));
  assert.ok(!inRange({due:'2026-11-10',status:'已完成'},'overdue',today));
  assert.ok(!inRange({},'today',today));
  assert.ok(inRange({due:today},'today',today));
});
test('search covers city and notes, combines status, sorts due dates', () => {
  const records = [{id:'a',title:'工程师',city:'深圳',status:'已投递',due:'2027-01-01'},
    {id:'b',title:'研究员',notes:'深圳机器人',status:'待投递',due:'2026-12-01'}];
  assert.deepEqual(filtered(records,'深圳','','all').map(x => x.id),['b','a']);
  assert.deepEqual(filtered(records,'深圳','已投递','all').map(x => x.id),['a']);
});
test('task ancestry rejects cycles and invalid date ranges', () => {
  const tasks = [{id:'a',parent:''},{id:'b',parent:'a'},{id:'c',parent:'b'}];
  assert.throws(() => validateTask({id:'a',parent:'c'},tasks));
  assert.throws(() => validateTask({id:'a',parent:'a'},tasks));
  assert.throws(() => validateTask({id:'d',parent:'missing'},tasks));
  assert.throws(() => validateTask({id:'d',start:'2027-01-02',due:'2027-01-01'},tasks));
  assert.doesNotThrow(() => validateTask({id:'d',parent:'b'},tasks));
});
