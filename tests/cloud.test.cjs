const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dist/cloud.js'), 'utf8');
function setup(handler, initial = null) {
  const saved = new Map(initial ? [['leaders-visits-session-v1', JSON.stringify(initial)]] : []);
  const calls = [], events = [];
  const context = { URLSearchParams, AbortController, setTimeout, clearTimeout, Date, JSON, Event, crypto: globalThis.crypto,
    sessionStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) },
    window: { dispatchEvent: e => events.push(e.type) },
    fetch: async (url, options) => { calls.push({ url, options }); return handler(url, options); }
  };
  vm.createContext(context); vm.runInContext(source + ';this.api=VisitCloud;', context);
  return { api: context.api, saved, calls, events };
}
const session = { access_token: 'test-access', refresh_token: 'test-refresh', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } };
const ok = value => ({ ok: true, status: 200, json: async () => value });
test('login uses password grant, then verifies server user and account allowlist', async () => {
  const s = setup(url => ok(url.includes('/token?') ? session : url.endsWith('/user') ? session.user : [{ user_id: 'u1' }]));
  await s.api.login('test@example.com', 'example-test-password');
  assert.equal((await s.api.verify()).id, 'u1');
  assert.match(s.calls[0].url, /grant_type=password/);
  assert.equal(s.calls[0].options.headers.Authorization, undefined);
  assert.equal(s.calls[1].options.headers.Authorization, 'Bearer test-access');
  assert(![...s.saved.values()].join('').includes('example-test-password'));
});
test('a different authenticated account is rejected', async () => {
  const s = setup(url => ok(url.endsWith('/user') ? session.user : []), session);
  await assert.rejects(s.api.verify(), /ACCOUNT_NOT_ALLOWED/);
});
test('all pages are fetched even if backend max-rows is smaller than page size', async () => {
  const s = setup(url => { const p = new URL(url).searchParams; const offset = Number(p.get('offset')); return ok(offset < 1205 ? Array.from({ length: Math.min(200, 1205 - offset) }, (_, i) => ({ id: String(i + offset), answers: {}, created_at: '2026-01-01', updated_at: '2026-01-01' })) : []); }, session);
  assert.equal((await s.api.list()).length, 1205);
  assert.equal(s.calls.length, 8);
});
test('date filters include both boundaries and are omitted for export-all', async () => {
  const s = setup(() => ok([]), session); await s.api.list('2026-09-01', '2026-09-15'); await s.api.list();
  assert.deepEqual(new URL(s.calls[0].url).searchParams.getAll('visit_date'), ['gte.2026-09-01', 'lte.2026-09-15']);
  assert(!new URL(s.calls[1].url).searchParams.has('visit_date'));
});
test('empty visits use RPC and preserve optional date and photo', async () => {
  let body; const s = setup((url, options) => { body = JSON.parse(options.body); return ok({ id: body.p_id, answers: body.p_answers, photo_path: body.p_photo_path, created_at: 'now', updated_at: 'now' }); }, session);
  const r = await s.api.save({ id: 'v1', data: { date: '', photo: '' }, photoChanged: false });
  assert.equal(r.id, 'v1'); assert.equal(body.p_photo_path, null); assert.equal(body.p_expected_updated, null);
  assert.equal(body.p_answers.date, ''); assert(!('photo' in body.p_answers));
});
test('expired access token refreshes once for concurrent requests', async () => {
  const s = setup(url => ok(url.includes('/token?') ? session : []), { ...session, expires_at: 1 });
  await Promise.all([s.api.list(), s.api.list()]);
  assert.equal(s.calls.filter(c => c.url.includes('refresh_token')).length, 1);
});
test('RPC composite records returned as an array are normalized', async () => {
  const s = setup(() => ok([{ id: 'v1', answers: {}, created_at: 'now', updated_at: 'now' }]), session);
  assert.equal((await s.api.save({ id: 'v1', data: {}, photoChanged: false })).id, 'v1');
});
test('invalid refresh locks the app and clears stored credentials', async () => {
  const s = setup(() => ({ ok: false, status: 400, json: async () => ({ message: 'invalid token' }) }), { ...session, expires_at: 1 });
  await assert.rejects(s.api.list()); assert.equal(s.api.hasSession(), false); assert.equal(s.saved.size, 0); assert.deepEqual(s.events, ['visit-auth-expired']);
});
test('network errors do not discard the session', async () => {
  const s = setup(() => { throw new Error('offline'); }, { ...session, expires_at: 1 });
  await assert.rejects(s.api.list(), /offline/); assert.equal(s.api.hasSession(), true);
});
test('delete with a stale version reports a conflict', async () => {
  const s = setup(() => ok([]), session);
  await assert.rejects(s.api.remove({ id: 'v1', updated: 'old-version' }), /VISIT_CONFLICT/);
  assert.equal(new URL(s.calls[0].url).searchParams.get('updated_at'), 'eq.old-version');
});
