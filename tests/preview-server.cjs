// Local-only manual QA preview. Mock data is never sent to Supabase or deployed.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../dist');
function bootstrap() {
  const user = { id: 'f141e892-971b-47d5-92af-e99287757000' };
  const token = { user, access_token: 'local-test-only', refresh_token: 'local-test-only', expires_at: Date.now() / 1000 + 3600 };
  sessionStorage.setItem('leaders-visits-session-v1', JSON.stringify(token));
  const rows = new Map([
    ['a141e892-971b-47d5-92af-e99287757001', { id: 'a141e892-971b-47d5-92af-e99287757001', answers: { customer: 'متجر الاختبار العربي', area: 'دمشق', district: 'الصالحية', route: 'خط تجريبي', date: '2026-09-15', knows: '0', productNotes: 'ملاحظات تجريبية فقط' }, visit_date: '2026-09-15', created_at: '2026-09-15T10:00:00Z', updated_at: '2026-09-15T10:00:00Z' }],
    ['a141e892-971b-47d5-92af-e99287757002', { id: 'a141e892-971b-47d5-92af-e99287757002', answers: {}, visit_date: null, created_at: '2026-09-14T10:00:00Z', updated_at: '2026-09-14T10:00:00Z' }]
  ]);
  const original = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const url = new URL(input, location.href);
    if (!url.hostname.endsWith('.supabase.co')) return original(input, opts);
    const reply = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
    if (url.pathname.endsWith('/user')) return reply(user);
    if (url.pathname.endsWith('/token')) return reply(token);
    if (url.pathname.endsWith('/logout')) return reply({});
    if (url.pathname.includes('/visit_accounts')) return reply([{ user_id: user.id }]);
    if (url.pathname.endsWith('/rpc/save_visit')) {
      const b = JSON.parse(opts.body), old = rows.get(b.p_id);
      if (old && old.updated_at !== b.p_expected_updated) return reply({ message: 'VISIT_CONFLICT', code: 'P0001' }, 400);
      const row = { id: b.p_id, answers: b.p_answers, photo_path: b.p_photo_path, visit_date: b.p_answers.date || null, created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
      rows.set(row.id, row); return reply(row);
    }
    if (url.pathname.endsWith('/visits')) {
      let list = [...rows.values()];
      if (url.searchParams.has('id')) list = list.filter(r => r.id === url.searchParams.get('id').slice(3));
      for (const f of url.searchParams.getAll('visit_date')) list = list.filter(r => r.visit_date && (f.startsWith('gte.') ? r.visit_date >= f.slice(4) : r.visit_date <= f.slice(4)));
      if (opts.method === 'DELETE') { list.forEach(r => rows.delete(r.id)); return reply(list); }
      return reply(list.slice(Number(url.searchParams.get('offset') || 0)));
    }
    return reply({ message: 'Unsupported mock endpoint' }, 404);
  };
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' data: https://nflrbopsqpjqabnhwstb.supabase.co; object-src 'none'");
  if (url.pathname === '/qa-bootstrap.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('(' + bootstrap.toString() + ')();'); return; }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  if (url.pathname === '/' && url.searchParams.has('mock')) {
    res.end(fs.readFileSync(file, 'utf8').replace('<script src="cloud.js', '<script src="qa-bootstrap.js"></script><script src="cloud.js')); return;
  }
  fs.createReadStream(file).pipe(res);
}).listen(4173, '0.0.0.0', () => console.log('Local QA preview: http://localhost:4173/?mock=1'));
