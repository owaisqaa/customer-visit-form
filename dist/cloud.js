'use strict';
// The publishable key is intentionally public. Database and Storage RLS enforce access.
const VisitCloud = (() => {
  const base = 'https://nflrbopsqpjqabnhwstb.supabase.co';
  const key = 'sb_publishable_xFJHvJscR-KpWSgpdR3OmQ_9zaqlXcx';
  const sessionKey = 'leaders-visits-session-v1';
  let session = null, refreshing = null;
  try { session = JSON.parse(sessionStorage.getItem(sessionKey)); } catch {}
  function remember(value) {
    session = value;
    try { value ? sessionStorage.setItem(sessionKey, JSON.stringify(value)) : sessionStorage.removeItem(sessionKey); } catch {}
  }
  function expire() {
    remember(null);
    window.dispatchEvent(new Event('visit-auth-expired'));
  }
  async function raw(path, options = {}, token) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(base + path, {
        ...options, signal: controller.signal,
        headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Object.assign(new Error(body.message || body.msg || body.error_description || body.error || 'Request failed'), { status: response.status, code: body.code });
      }
      if (options.blob) return response.blob();
      if (response.status === 204) return null;
      return response.json().catch(() => null);
    } finally { clearTimeout(timer); }
  }
  function json(method, body, headers = {}) { return { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }; }
  async function refresh() {
    if (!session?.refresh_token) throw new Error('LOGIN_REQUIRED');
    if (!refreshing) {
      refreshing = raw('/auth/v1/token?grant_type=refresh_token', json('POST', { refresh_token: session.refresh_token }))
        .then(value => { remember(value); return value; })
        .catch(error => { if ([400, 401, 403].includes(error.status)) expire(); throw error; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }
  async function request(path, options = {}) {
    if (!session) throw new Error('LOGIN_REQUIRED');
    if (!session.expires_at || session.expires_at * 1000 < Date.now() + 60000) await refresh();
    try { return await raw(path, options, session.access_token); }
    catch (error) {
      if (error.status !== 401) throw error;
      await refresh();
      try { return await raw(path, options, session.access_token); }
      catch (retryError) { if (retryError.status === 401) expire(); throw retryError; }
    }
  }
  async function login(email, password) {
    remember(await raw('/auth/v1/token?grant_type=password', json('POST', { email, password })));
    return session.user;
  }
  async function verify() {
    const user = await request('/auth/v1/user');
    const allowed = await request('/rest/v1/visit_accounts?select=user_id');
    if (!allowed?.some(row => row.user_id === user.id)) throw new Error('ACCOUNT_NOT_ALLOWED');
    return user;
  }
  async function logout() {
    const token = session?.access_token;
    remember(null);
    if (token) await raw('/auth/v1/logout?scope=local', { method: 'POST' }, token).catch(() => {});
  }
  const record = row => ({ id: row.id, data: { ...row.answers, date: row.visit_date || '' }, photoPath: row.photo_path || '', created: row.created_at, updated: row.updated_at });
  async function list(from = '', to = '') {
    const params = new URLSearchParams({ select: '*', order: 'created_at.asc,id.asc', limit: '500', created_at: `lte.${new Date().toISOString()}` });
    if (from) params.append('visit_date', `gte.${from}`);
    if (to) params.append('visit_date', `lte.${to}`);
    const rows = [];
    // Continue even when the server's max-rows setting is smaller than 500.
    for (;;) {
      params.set('offset', String(rows.length));
      const page = await request('/rest/v1/visits?' + params);
      if (!Array.isArray(page)) throw new Error('INVALID_RESPONSE');
      if (!page.length) break;
      rows.push(...page);
    }
    return rows.map(record);
  }
  async function get(id) {
    const rows = await request('/rest/v1/visits?' + new URLSearchParams({ id: `eq.${id}`, select: '*' }));
    if (!rows?.length) throw new Error('VISIT_NOT_FOUND');
    return record(rows[0]);
  }
  const photoEndpoint = path => '/storage/v1/object/visit-photos/' + path.split('/').map(encodeURIComponent).join('/');
  async function save(r) {
    const answers = { ...r.data }; delete answers.photo;
    let photoPath = r.photoPath || '';
    if (r.data.photo && r.photoChanged !== false) {
      const blob = await (await fetch(r.data.photo)).blob();
      photoPath = `${session.user.id}/${r.id}/${crypto.randomUUID()}.jpg`;
      await request(photoEndpoint(photoPath), { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: blob });
    } else if (!r.data.photo && r.photoChanged) photoPath = '';
    // RPC checks the prior version, preventing two devices from silently overwriting one another.
    const result = await request('/rest/v1/rpc/save_visit', json('POST', {
      p_id: r.id, p_answers: answers, p_photo_path: photoPath || null,
      p_expected_updated: r.updated || null, p_created: r.created || null
    }));
    const row = Array.isArray(result) ? result[0] : result;
    if (!row?.id) throw new Error('INVALID_RESPONSE');
    const saved = record(row);
    saved.data.photo = r.data.photo || '';
    return saved;
  }
  async function remove(r) {
    const rows = await request('/rest/v1/visits?' + new URLSearchParams({ id: `eq.${r.id}`, updated_at: `eq.${r.updated}` }), { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    if (!rows?.length) throw new Error('VISIT_CONFLICT');
    // Old image versions remain private; avoid unsafe cross-resource deletion races.
  }
  async function withPhoto(r) {
    if (!r.photoPath || r.data.photo) return r;
    const blob = await request('/storage/v1/object/authenticated/visit-photos/' + r.photoPath.split('/').map(encodeURIComponent).join('/'), { blob: true });
    const photo = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    return { ...r, data: { ...r.data, photo } };
  }
  return { login, logout, verify, list, get, save, remove, withPhoto, hasSession: () => Boolean(session), userId: () => session?.user?.id };
})();
