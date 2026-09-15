'use strict';
let activeRecord = null, portalBusy = false, loggedIn = false, visibleLimit = 50, legacyRecords = [];
const draftKey = () => `cloud:${VisitCloud.userId()}`;
function cloudError(error) {
  if (/VISIT_CONFLICT/.test(error.message)) return 'عُدّل التقرير من جهاز آخر أو سبق استيراده. حدّث السجل وافتح النسخة الأخيرة؛ مسودتك الحالية ما زالت محفوظة.';
  if (error.message === 'ACCOUNT_NOT_ALLOWED') return 'هذا الحساب غير معتمد للوصول إلى سجل الزيارات.';
  if (error.message === 'VISIT_NOT_FOUND') return 'التقرير غير موجود أو حُذف. حدّث السجل.';
  if (error.status === 404 || ['PGRST202', 'PGRST205', '42P01'].includes(error.code)) return 'إعداد قاعدة البيانات لم يكتمل. شغّل ملف supabase/setup.sql في SQL Editor ثم حاول مجدداً.';
  if (error.message === 'LOGIN_REQUIRED' || [401, 403].includes(error.status)) return 'انتهت الجلسة أو لا توجد صلاحية. سجّل الدخول مجدداً وتأكد من إعداد قاعدة البيانات.';
  return 'تعذّر الاتصال أو إكمال العملية. لم نؤكد الحفظ في قاعدة البيانات. احتفظ بالمسودة وحاول مجدداً.';
}
function busy(value) {
  portalBusy = value;
  $('#appMain').inert = value; $('#headerActions').inert = value;
  $('#appMain').setAttribute('aria-busy', String(value));
}
writeDraft = function () {
  if (!loggedIn) return Promise.resolve();
  const snapshot = { id: draftKey(), data: data(), activeId, activeRecord, dirty };
  saveChain = saveChain.catch(() => {}).then(() => tx('draft', 'readwrite', s => s.put(snapshot)));
  saveChain.then(() => { $('#draftState').textContent = 'المسودة محفوظة على هذا الجهاز'; }, () => { $('#draftState').textContent = 'تعذّر حفظ المسودة محلياً'; });
  return saveChain;
};
const originalNewReport = newReport;
newReport = async function () {
  if (portalBusy || !loggedIn) return;
  await originalNewReport();
  if (!activeId) { activeRecord = null; await writeDraft().catch(() => {}); }
};
$('#new').onclick = newReport; $('#clear').onclick = newReport;
saveReport = async function () {
  if (saving || portalBusy || !loggedIn || !validate()) return null;
  saving = true; busy(true); clearTimeout(timer);
  activeId ||= crypto.randomUUID();
  const snapshot = data();
  const candidate = {
    id: activeId, data: snapshot, created: activeRecord?.created, updated: activeRecord?.updated,
    photoPath: activeRecord?.photoPath || '', photoChanged: snapshot.photo !== (activeRecord?.data?.photo || '')
  };
  await writeDraft().catch(() => {});
  try {
    const saved = await VisitCloud.save(candidate);
    if (!loggedIn) return null;
    activeRecord = saved; activeId = saved.id; dirty = false;
    records = [saved, ...records.filter(r => r.id !== saved.id)];
    renderHistory(); $('#editorTitle').textContent = 'تعديل تقرير محفوظ';
    await writeDraft().catch(() => {});
    notify('تم حفظ التقرير في قاعدة البيانات. يمكنك فتحه من أي جهاز بعد تسجيل الدخول.');
    return saved;
  } catch (error) { notify(cloudError(error), true); return null; }
  finally { saving = false; busy(false); }
};
$('#pdf').onclick = async () => {
  if (portalBusy || photoBusy || !loggedIn) return;
  const r = await saveReport();
  if (r) { busy(true); try { await exportPDF(r, $('#pdf')); } finally { busy(false); } return; }
  if (loggedIn && await confirmed('تنزيل PDF دون حفظ في قاعدة البيانات؟', 'تعذّر الحفظ السحابي. يمكنك الاحتفاظ بنسخة PDF؛ المسودة ستبقى لإعادة محاولة الحفظ.')) {
    busy(true); try { await exportPDF({ data: data() }, $('#pdf')); } finally { busy(false); }
    notify('تم تجهيز PDF فقط. لم يُؤكّد حفظ هذه الزيارة في قاعدة البيانات.', true);
  }
};
function historyFiltered() {
  const from = $('#dateFrom').value, to = $('#dateTo').value, q = $('#historySearch').value.trim().toLocaleLowerCase();
  return records.filter(r => (!from || (r.data.date && r.data.date >= from)) && (!to || (r.data.date && r.data.date <= to)) &&
    (!q || [r.data.customer, r.data.area, r.data.district, r.data.route].some(v => String(v || '').toLocaleLowerCase().includes(q))))
    .sort((a, b) => b.updated.localeCompare(a.updated));
}
renderHistory = function () {
  $('#count').textContent = records.length;
  const filtered = historyFiltered(), invalid = $('#dateFrom').value && $('#dateTo').value && $('#dateFrom').value > $('#dateTo').value;
  $('#historySummary').textContent = invalid ? 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.' : `عرض ${Math.min(visibleLimit, filtered.length)} من ${filtered.length} زيارة · الإجمالي ${records.length}`;
  $('#moreHistory').hidden = filtered.length <= visibleLimit || Boolean(invalid);
  $('#historyList').innerHTML = invalid ? '' : filtered.length ? `<div class="historyTableWrap"><table class="historyTable"><thead><tr><th scope="col">الزبون</th><th scope="col">تاريخ الزيارة</th><th scope="col">المنطقة</th><th scope="col">خط السير</th><th scope="col">الإجراءات</th></tr></thead><tbody>${filtered.slice(0, visibleLimit).map(r => `<tr><td>${esc(r.data.customer?.trim() || 'تقرير بدون اسم')}</td><td>${esc(r.data.date || 'بدون تاريخ')}</td><td>${esc(r.data.area || '—')}</td><td>${esc(r.data.route || '—')}</td><td><div class="actions"><button class="primary" data-open="${esc(r.id)}">فتح وتعديل</button><button class="outline" data-pdf="${esc(r.id)}">PDF</button><button class="outline delete" data-delete="${esc(r.id)}">حذف</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>لا توجد زيارات مطابقة</h3><p>احفظ زيارة جديدة أو ألغِ التصفية لعرض بقية التقارير.</p></div>';
};
async function refreshHistory() {
  records = await VisitCloud.list();
  if (!loggedIn) { records = []; return; }
  visibleLimit = 50; renderHistory();
}
async function openVisit(id) {
  if (dirty && !await confirmed('فتح تقرير محفوظ؟', 'سيحل التقرير المحدد محل المسودة الحالية.')) return;
  const r = await VisitCloud.withPhoto(await VisitCloud.get(id));
  if (!loggedIn) return;
  clearTimeout(timer); revision++; activeRecord = r; activeId = r.id; dirty = false;
  applyData(r.data); $('#editorTitle').textContent = 'تعديل تقرير محفوظ'; showView('form');
  await writeDraft().catch(() => {});
  notify('التقرير مفتوح للتعديل. اضغط حفظ لتحديث النسخة الموجودة.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#historyTab').onclick = async () => {
  if (portalBusy || !loggedIn) return;
  showView('history'); busy(true);
  try { await refreshHistory(); notify('تم تحديث سجل الزيارات من قاعدة البيانات.'); }
  catch (error) { notify(cloudError(error), true); }
  finally { busy(false); }
};
$('#refreshHistory').onclick = $('#historyTab').onclick;
$('#historyList').onclick = async e => {
  const b = e.target.closest('button'); if (!b || portalBusy || !loggedIn) return;
  const id = b.dataset.open || b.dataset.pdf || b.dataset.delete;
  busy(true);
  try {
    if (b.dataset.open) await openVisit(id);
    else if (b.dataset.pdf) await exportPDF(await VisitCloud.withPhoto(await VisitCloud.get(id)), b);
    else if (await confirmed('حذف الزيارة من قاعدة البيانات؟', 'سيختفي هذا التقرير من السجل على جميع الأجهزة. لا يمكن التراجع من الموقع.')) {
      await VisitCloud.remove(records.find(r => r.id === id));
      records = records.filter(r => r.id !== id);
      if (activeId === id) { activeId = null; activeRecord = null; dirty = true; await writeDraft().catch(() => {}); }
      renderHistory(); notify('تم حذف الزيارة من قاعدة البيانات.');
    }
  } catch (error) { notify(cloudError(error), true); }
  finally { busy(false); }
};
for (const id of ['historySearch', 'dateFrom', 'dateTo']) $('#' + id).oninput = () => { visibleLimit = 50; renderHistory(); };
$('#resetFilters').onclick = () => { for (const id of ['historySearch', 'dateFrom', 'dateTo']) $('#' + id).value = ''; renderHistory(); };
$('#moreHistory').onclick = () => { visibleLimit += 50; renderHistory(); };
let pendingExcel = null;
async function exportExcel(all) {
  if (portalBusy || !loggedIn) return;
  const from = all ? '' : $('#dateFrom').value, to = all ? '' : $('#dateTo').value;
  if (!all && (!from || !to)) { notify('اختر تاريخ البداية والنهاية لتصدير الفترة.', true); return; }
  if (from && to && from > to) { notify('تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.', true); return; }
  busy(true); notify('جارٍ جلب الزيارات وتجهيز ملف Excel…');
  try {
    const rows = await VisitCloud.list(from, to);
    if (!loggedIn) return;
    if (!rows.length) { notify('لا توجد زيارات لتصديرها ضمن هذا الاختيار.'); return; }
    const blob = await VisitExcel.build(rows, fields, window.location.origin);
    const name = all ? 'جميع-الزيارات.xlsx' : `الزيارات-${from}-${to}.xlsx`;
    const file = typeof File === 'function' ? new File([blob], name, { type: blob.type }) : null;
    pendingExcel = { blob, file, name, url: null };
    let canShare = false; try { canShare = Boolean(file && navigator.share && navigator.canShare?.({ files: [file] })); } catch {}
    $('#excelShare').hidden = !canShare; $('#excelShare').disabled = false;
    $('#excelDownload').download = name; $('#excelDownload').href = '#';
    $('#excelSummary').textContent = `${rows.length} زيارة · ${all ? 'جميع التواريخ، بما فيها الزيارات بلا تاريخ' : from + ' — ' + to}`;
    $('#excelStatus').textContent = 'روابط الصور تفتح الزيارة في الموقع وتتطلب تسجيل الدخول. على iPhone يمكنك اختيار حفظ في الملفات.';
    $('#excelDelivery').showModal(); notify('ملف Excel جاهز.');
  } catch (error) { notify(error.message === 'EXCEL_CELL_TOO_LONG' ? 'إحدى الإجابات أطول من حد خلية Excel (32767 حرفاً). قصّرها أو صدّر فترة لا تتضمنها؛ لم تُحذف أي بيانات.' : cloudError(error), true); }
  finally { busy(false); }
}
$('#exportAll').onclick = () => exportExcel(true); $('#exportDates').onclick = () => exportExcel(false);
$('#excelShare').onclick = async () => {
  if (!pendingExcel?.file) return;
  $('#excelShare').disabled = true;
  try { await navigator.share({ files: [pendingExcel.file] }); }
  catch (e) { $('#excelStatus').textContent = e.name === 'AbortError' ? 'أُغلقت المشاركة. يمكنك المحاولة مجدداً.' : 'تعذّرت المشاركة. استخدم زر تنزيل Excel.'; }
  finally { $('#excelShare').disabled = false; }
};
$('#excelDownload').onclick = e => {
  if (!pendingExcel) { e.preventDefault(); return; }
  pendingExcel.url ||= URL.createObjectURL(pendingExcel.blob);
  e.currentTarget.href = pendingExcel.url;
};
$('#excelBack').onclick = () => $('#excelDelivery').close();
$('#excelDelivery').addEventListener('close', () => { pendingExcel = null; $('#excelDownload').removeAttribute('href'); });
async function loadLocal() {
  try {
    if (!db) db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('iq-customer-visits-v1', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('reports', { keyPath: 'id' }); r.result.createObjectStore('draft', { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(Error('blocked'));
    });
    legacyRecords = await tx('reports', 'readonly', s => s.getAll()) || [];
    const imported = await tx('draft', 'readonly', s => s.get('legacy-imports:' + VisitCloud.userId()));
    legacyRecords = legacyRecords.filter(r => !imported?.ids?.includes(r.id));
    $('#legacyPanel').hidden = !legacyRecords.length;
    $('#legacyCount').textContent = `يوجد ${legacyRecords.length} تقريراً قديماً محفوظاً في هذا المتصفح فقط.`;
    const draft = await tx('draft', 'readonly', s => s.get(draftKey()));
    if (draft) { activeId = draft.activeId; activeRecord = draft.activeRecord || null; dirty = draft.dirty; applyData(draft.data); $('#draftState').textContent = 'تم استرجاع المسودة من هذا الجهاز'; }
    else {
      const old = await tx('draft', 'readonly', s => s.get('current'));
      if (old?.dirty && await confirmed('استرجاع المسودة القديمة؟', 'وُجدت مسودة من النسخة السابقة على هذا الجهاز. هل تريد استرجاعها كزيارة جديدة؟')) { applyData(old.data); activeId = null; activeRecord = null; dirty = true; await writeDraft(); }
    }
    $('#editorTitle').textContent = activeRecord ? 'تعديل تقرير محفوظ' : 'زيارة جديدة';
  } catch { notify('تعذّر استخدام تخزين المتصفح. الحفظ السحابي متاح، لكن المسودة لن تبقى بعد إغلاق الصفحة.', true); }
}
$('#importLegacy').onclick = async () => {
  if (portalBusy || !loggedIn || !legacyRecords.length) return;
  if (!await confirmed('استيراد التقارير القديمة؟', `سيُرفع ${legacyRecords.length} تقريراً وصوره إلى قاعدة البيانات. لن تُستبدل تقارير موجودة بالمعرّف نفسه.`)) return;
  busy(true); let imported = 0, skipped = 0;
  try {
    const key = 'legacy-imports:' + VisitCloud.userId();
    const marker = await tx('draft', 'readonly', s => s.get(key)) || { id: key, ids: [] };
    for (const r of legacyRecords) {
      const existing = await VisitCloud.get(r.id).catch(e => { if (e.message === 'VISIT_NOT_FOUND') return null; throw e; });
      if (!existing) { await VisitCloud.save({ ...r, updated: null, photoChanged: true }); imported++; }
      else skipped++;
      marker.ids.push(r.id); await tx('draft', 'readwrite', s => s.put(marker));
      notify(`تم استيراد ${imported} زيارة، وتجاوز ${skipped} زيارة موجودة مسبقاً…`);
    }
    legacyRecords = []; $('#legacyPanel').hidden = true; await refreshHistory();
    notify(`اكتمل الاستيراد: ${imported} زيارة جديدة، و${skipped} موجودة مسبقاً. النسخ القديمة باقية على الجهاز.`);
  } catch (error) { notify(`اكتمل رفع ${imported} زيارة قبل توقف الاستيراد. يمكنك إعادة المحاولة دون تكرار. ${cloudError(error)}`, true); }
  finally { busy(false); }
};
function lockPage() {
  loggedIn = false; clearTimeout(timer); revision++;
  $('#appMain').hidden = true; $('#headerActions').hidden = true; $('#loginPanel').hidden = false;
  for (const id of ['pdfDelivery', 'excelDelivery', 'confirm']) if ($('#' + id).open) $('#' + id).close();
  records = []; legacyRecords = []; activeId = null; activeRecord = null; dirty = false;
  applyData(); $('#historyList').innerHTML = ''; $('#notice').textContent = ''; $('#loginPassword').value = '';
}
async function enter() {
  await VisitCloud.verify();
  loggedIn = true; $('#loginPanel').hidden = true; $('#appMain').hidden = false; $('#headerActions').hidden = false;
  busy(true);
  try {
    showView('form'); await loadLocal(); await refreshHistory();
    const requested = new URLSearchParams(window.location.search).get('visit');
    if (requested && /^[0-9a-f-]{36}$/i.test(requested)) { await openVisit(requested); history.replaceState(null, '', window.location.pathname); }
  } catch (error) { notify(cloudError(error), true); }
  finally { busy(false); }
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#loginButton').disabled = true; $('#loginStatus').textContent = 'جارٍ تسجيل الدخول…';
  try {
    await VisitCloud.login($('#loginEmail').value.trim(), $('#loginPassword').value);
    $('#loginPassword').value = ''; await enter(); $('#loginStatus').textContent = '';
  } catch (error) { $('#loginPassword').value = ''; $('#loginStatus').textContent = error.status === 400 ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو الحساب غير مؤكد.' : cloudError(error); }
  finally { $('#loginButton').disabled = false; }
};
$('#logout').onclick = async () => {
  if (portalBusy) return;
  if (dirty && !await confirmed('تسجيل الخروج؟', 'المسودة غير محفوظة في قاعدة البيانات. ستبقى على هذا الجهاز لاسترجاعها عند تسجيل الدخول مجدداً.')) return;
  await writeDraft().catch(() => {}); lockPage();
  $('#loginButton').disabled = true;
  await VisitCloud.logout(); $('#loginStatus').textContent = 'تم تسجيل الخروج.'; $('#loginButton').disabled = false;
};
window.addEventListener('visit-auth-expired', () => { lockPage(); $('#loginStatus').textContent = 'انتهت الجلسة. سجّل الدخول مجدداً.'; });
(async () => {
  $('#loginButton').disabled = true;
  try { if (VisitCloud.hasSession()) await enter(); else $('#loginStatus').textContent = ''; }
  catch (error) { lockPage(); $('#loginStatus').textContent = cloudError(error); }
  finally { $('#loginButton').disabled = false; }
})();
