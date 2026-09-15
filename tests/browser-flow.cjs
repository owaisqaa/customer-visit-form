// Local browser integration tests with a mock Supabase server. No live customer records are written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const root = path.join(__dirname, '../dist');
const out = process.env.VISITS_TEST_OUTPUT || '/tmp/visits-browser-qa';
fs.mkdirSync(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(root, name === '/' ? 'index.html' : name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  // Match production CSP during the test, including library compatibility.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' data: https://nflrbopsqpjqabnhwstb.supabase.co; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const rows = new Map(), photos = new Map(); let offline = false;
    const user = { id: 'f141e892-971b-47d5-92af-e99287757000', email: 'test@example.com' };
    await page.route('https://nflrbopsqpjqabnhwstb.supabase.co/**', async route => {
      if (offline) { await route.abort('internetdisconnected'); return; }
      const req = route.request(), url = new URL(req.url()), body = req.postData(), headers = { 'Access-Control-Allow-Origin': '*' };
      const reply = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
      if (url.pathname.endsWith('/token')) return reply({ user, access_token: 'mock-token', refresh_token: 'mock-refresh', expires_at: Date.now() / 1000 + 3600 });
      if (url.pathname.endsWith('/user')) return reply(user);
      if (url.pathname.endsWith('/logout')) return reply({});
      if (url.pathname.includes('/visit_accounts')) return reply([{ user_id: user.id }]);
      if (url.pathname.includes('/storage/v1/object/')) {
        if (req.method() === 'POST') { photos.set(url.pathname.split('/visit-photos/')[1], req.postDataBuffer()); return reply({}); }
        const bytes = photos.get(url.pathname.split('/visit-photos/')[1]);
        return bytes ? route.fulfill({ status: 200, headers, contentType: 'image/jpeg', body: bytes }) : reply({}, 404);
      }
      if (url.pathname.endsWith('/rpc/save_visit')) {
        const b = JSON.parse(body), existing = rows.get(b.p_id);
        if (existing && existing.updated_at !== b.p_expected_updated) return reply({ message: 'VISIT_CONFLICT', code: 'P0001' }, 400);
        const row = { id: b.p_id, answers: b.p_answers, photo_path: b.p_photo_path, visit_date: b.p_answers.date || null, created_at: existing?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
        rows.set(row.id, row); return reply(row);
      }
      if (url.pathname.endsWith('/visits')) {
        let list = [...rows.values()];
        if (url.searchParams.has('id')) list = list.filter(r => r.id === url.searchParams.get('id').slice(3));
        for (const filter of url.searchParams.getAll('visit_date')) list = list.filter(r => r.visit_date && (filter.startsWith('gte.') ? r.visit_date >= filter.slice(4) : r.visit_date <= filter.slice(4)));
        if (req.method() === 'DELETE') { list.forEach(r => rows.delete(r.id)); return reply(list); }
        return reply(list.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + 500));
      }
      return reply({ message: 'Unhandled mock ' + url.pathname }, 500);
    });
    await page.goto(origin); await page.waitForFunction(() => !document.querySelector('#loginButton').disabled);
    assert(await page.locator('#appMain').isHidden());
    await page.screenshot({ path: path.join(out, 'login-mobile.png'), fullPage: true });
    await page.fill('#loginEmail', 'test@example.com'); await page.fill('#loginPassword', 'test-only'); await page.click('#loginButton');
    await page.waitForFunction(() => !document.querySelector('#appMain').hidden && !document.querySelector('#appMain').inert);
    await page.click('#save'); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('تم حفظ التقرير في قاعدة'));
    assert.equal(rows.size, 1, 'empty form saved');
    await page.fill('#customer', 'متجر عربي'); await page.fill('#date', '2026-09-15');
    await page.check('input[name=knows][value="0"]');
    await page.click('#save'); await page.waitForFunction(() => !document.querySelector('#appMain').inert);
    assert.equal(rows.size, 1, 'edit updates same record'); assert.equal([...rows.values()][0].answers.knows, '0');
    await page.click('#new'); await page.waitForFunction(() => document.querySelector('#customer').value === '');
    await page.click('#save'); await page.waitForFunction(() => !document.querySelector('#appMain').inert); assert.equal(rows.size, 2);
    await page.click('#historyTab'); await page.waitForFunction(() => !document.querySelector('#appMain').inert);
    assert.equal(await page.locator('.historyTable tbody tr').count(), 2);
    await page.fill('#dateFrom', '2026-09-15'); await page.fill('#dateTo', '2026-09-15');
    assert.equal(await page.locator('.historyTable tbody tr').count(), 1);
    await page.screenshot({ path: path.join(out, 'history-mobile.png'), fullPage: true });
    await page.click('#exportDates'); await page.waitForSelector('#excelDelivery[open]');
    assert.match(await page.textContent('#excelSummary'), /^1 زيارة/);
    const downloadPromise = page.waitForEvent('download'); await page.click('#excelDownload'); const download = await downloadPromise;
    await download.saveAs(path.join(out, 'date-range.xlsx')); await page.click('#excelBack');
    await page.click('#exportAll'); await page.waitForSelector('#excelDelivery[open]'); assert.match(await page.textContent('#excelSummary'), /^2 زيارة/); await page.click('#excelBack');
    await page.click('[data-open]'); await page.waitForFunction(() => !document.querySelector('#appMain').inert);
    assert.equal(await page.inputValue('#customer'), 'متجر عربي');
    await page.click('#pdf'); await page.waitForSelector('#pdfDelivery[open]', { timeout: 30000 });
    const pdfBytes = await page.evaluate(async () => Array.from(new Uint8Array(await pendingPDF.blob.arrayBuffer())));
    const pdf = await require('../dist/pdf-lib.min.js').PDFDocument.load(Uint8Array.from(pdfBytes)); assert.equal(pdf.getPageCount(), 2);
    await page.click('#pdfBack');
    offline = true; await page.fill('#customer', 'مسودة دون اتصال'); await page.click('#save');
    await page.waitForFunction(() => !document.querySelector('#appMain').inert);
    assert.match(await page.textContent('#notice'), /لم نؤكد/); assert.equal([...rows.values()][0].answers.customer, 'متجر عربي');
    offline = false; await page.reload(); await page.waitForFunction(() => !document.querySelector('#appMain').hidden && !document.querySelector('#appMain').inert);
    assert.equal(await page.inputValue('#customer'), 'مسودة دون اتصال');
    await page.click('#save'); await page.waitForFunction(() => !document.querySelector('#appMain').inert);
    await page.click('#logout'); await page.waitForSelector('#loginPanel'); assert(await page.locator('#appMain').isHidden());
    assert.equal(await page.inputValue('#customer'), ''); assert.equal(await page.locator('.historyTable tbody tr').count(), 0);
    assert.deepEqual(errors, []); console.log('PASS: login gate, blank save, edit, clear, history, date filters, XLSX downloads, two-page PDF, offline draft recovery, logout.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
