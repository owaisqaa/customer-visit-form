const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function setup() {
  const elements = new Map(), inputs = {}, saved = [], listeners = {};
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, disabled: false, innerHTML: '', textContent: '',
      classList: { toggle() {}, remove() {} }, addEventListener() {}, setAttribute() {}, toggleAttribute() {}, removeAttribute() {},
      reset() { for (const key of Object.keys(inputs)) delete inputs[key]; },
      elements: { namedItem(id) { return { get value() { return inputs[id] || ''; }, set value(v) { inputs[id] = v; } }; } },
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(id);
  }
  const cloud = { hasSession: () => false, userId: () => 'user1', save: async r => { saved.push(r); return { ...r, updated: '2026-09-15T10:00:00Z', created: '2026-09-15T10:00:00Z' }; } };
  const ctx = { document: { querySelector: element, querySelectorAll: () => [], addEventListener() {} }, window: { addEventListener(name, fn) { listeners[name] = fn; }, scrollTo() {} },
    navigator: {}, VisitCloud: cloud, URLSearchParams, Blob, crypto: globalThis.crypto, setTimeout, clearTimeout,
    FormData: class { [Symbol.iterator]() { return Object.entries(inputs)[Symbol.iterator](); } }
  };
  vm.createContext(ctx);
  for (const file of ['app.js', 'portal.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/' + file), 'utf8'), ctx);
  vm.runInContext('loggedIn=true; tx=async()=>{};', ctx);
  return { ctx, element, inputs, saved, cloud, run: code => vm.runInContext(code, ctx) };
}
test('portal saves an empty form and updates the same report on repeated saves', async () => {
  const s = setup(); await s.run('saveReport()'); assert.equal(s.saved.length, 1);
  const id = s.saved[0].id; s.inputs.customer = 'متجر تجريبي'; await s.run('saveReport()');
  assert.equal(s.saved[1].id, id); assert.equal(s.saved[1].updated, '2026-09-15T10:00:00Z');
  assert.match(s.element('#notice').textContent, /تم حفظ التقرير في قاعدة البيانات/);
  assert.equal(s.element('#appMain').inert, false);
});
test('failed cloud save keeps form and retry ID, never claims success', async () => {
  const s = setup(); s.inputs.customer = 'مسودة'; s.cloud.save = async () => { throw new Error('network'); };
  assert.equal(await s.run('saveReport()'), null); const firstId = s.run('activeId');
  assert.equal(s.inputs.customer, 'مسودة'); assert.match(s.element('#notice').textContent, /لم نؤكد/);
  await s.run('saveReport()'); assert.equal(s.run('activeId'), firstId);
});
test('history escapes markup, applies inclusive dates, and retains zero scores in form', () => {
  const s = setup();
  s.run(`records=[{id:'v1',data:{customer:'<img onerror=alert(1)>',date:'2026-09-15'},updated:'2026-09-15'},{id:'v2',data:{},updated:'2026-09-14'}];renderHistory();`);
  assert.match(s.element('#historyList').innerHTML, /&lt;img/); assert(!s.element('#historyList').innerHTML.includes('<img'));
  s.element('#dateFrom').value = '2026-09-15'; s.element('#dateTo').value = '2026-09-15';
  s.run('renderHistory()'); assert.match(s.element('#historySummary').textContent, /عرض 1 من 1/);
  s.run('applyData({knows:0})'); assert.equal(s.inputs.knows, 0);
});
test('logout lock hides the app and clears rendered personal data', () => {
  const s = setup(); s.inputs.customer = 'private'; s.run('lockPage()');
  assert.equal(s.element('#appMain').hidden, true); assert.equal(s.element('#loginPanel').hidden, false);
  assert.equal(s.inputs.customer, ''); assert.equal(s.element('#historyList').innerHTML, '');
});
test('export date range validates both dates before accessing the database', async () => {
  const s = setup(); s.cloud.list = () => { throw Error('Should not query'); };
  await s.run('exportExcel(false)'); assert.match(s.element('#notice').textContent, /اختر تاريخ البداية/);
  s.element('#dateFrom').value = '2026-09-16'; s.element('#dateTo').value = '2026-09-15';
  await s.run('exportExcel(false)'); assert.match(s.element('#notice').textContent, /ألا يكون بعد/);
});
