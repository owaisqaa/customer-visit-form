const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('../dist/jszip.min.js');
const context = { JSZip, Blob, URL, Date };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/excel.js'), 'utf8') + ';this.api=VisitExcel;', context);
const fields = [['customer', 'اسم الزبون', 'text'], ['date', 'تاريخ الزيارة', 'date'], ['score', 'التقييم', 'rating'], ['photo', 'صورة المحل', 'photo']];
test('xlsx preserves Arabic, blank vs numeric zero, real dates, and safe literal strings', async () => {
  const blob = await context.api.build([{ id: 'v1', data: { customer: '=HYPERLINK("evil") & محل عربي', date: '2026-09-15', score: '0' }, created: '2026-09-15T12:00:00Z' }, { id: 'v2', data: {} }], fields, 'https://leadersgroup.netlify.app');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(xml, /محل عربي/); assert.match(xml, /&amp;/); assert(!xml.includes('<f>'));
  assert.match(xml, /r="C2" s="0"><v>0<\/v>/); assert.match(xml, /r="C3" s="0" t="inlineStr"/);
  assert.match(xml, /r="B2" s="2"><v>\d+/); assert.match(xml, /autoFilter ref="A1:G3"/);
  assert.match(xml, /rightToLeft="1"/); assert.match(xml, /state="frozen"/);
});
test('photo links go through login, with no credentials or expiring storage URLs', async () => {
  const blob = await context.api.build([{ id: 'visit-123', data: {}, photoPath: 'private/photo.jpg' }], fields, 'https://leadersgroup.netlify.app');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const links = await zip.file('xl/worksheets/_rels/sheet1.xml.rels').async('string');
  assert.match(links, /https:\/\/leadersgroup.netlify.app\/\?visit=visit-123/);
  assert(!links.includes('token')); assert(!links.includes('supabase'));
});
test('oversized answers fail visibly rather than silently truncate', async () => {
  await assert.rejects(context.api.build([{ id: 'v1', data: { customer: 'a'.repeat(32768) } }], fields, 'https://example.com'), /EXCEL_CELL_TOO_LONG/);
});

function table(xml) {
  return [...xml.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)].map(row => [...row[1].matchAll(/<c\b[^>]*>(.*?)<\/c>/gs)].map(cell => {
    const number = cell[1].match(/<v>(.*?)<\/v>/s);
    return number ? Number(number[1]) : (cell[1].match(/<t[^>]*>(.*?)<\/t>/s)?.[1] || '');
  }));
}
test('insights rank products, include zero ratings, and exclude blanks from percentages', async () => {
  const allFields = [
    ...fields, ['product0', 'بربيكان', 'rating'], ['product1', 'راني', 'rating'], ['product2', 'بايسن', 'rating'],
    ['knows', 'معرفة الأصناف', 'rating'], ['offered', 'عرض الأصناف', 'rating'], ['placement', 'موقع المنتجات', 'rating'],
    ['display', 'آرمة', 'yesno'], ['grade', 'تصنيف', 'grade'], ['locationRating', 'جودة الموقع', 'grade'],
    ['notes', 'ملاحظات المنتجات', 'textarea'], ['repNotes', 'ملاحظات المندوب', 'textarea']
  ];
  const records = [
    { id: 'a', data: { customer: '=unsafe', date: '2026-09-15', product0: '0', product1: '5', knows: '0', display: 'نعم', grade: 'A', notes: '=HYPERLINK("evil") & ملاحظة', repNotes: 'تعليق المندوب' } },
    { id: 'b', data: { product0: '5', product1: '3', knows: '5', display: 'لا', grade: 'B' } },
    { id: 'c', data: { product0: 'invalid', display: 'نعم' } },
    { id: 'd', data: {} }
  ];
  const zip = await JSZip.loadAsync(await (await context.api.build(records, allFields, 'https://example.com')).arrayBuffer());
  const workbook = await zip.file('xl/workbook.xml').async('string');
  assert(workbook.indexOf('name="الملخص"') < workbook.indexOf('name="ملاحظات الزبائن"'));
  assert(workbook.indexOf('name="ملاحظات الزبائن"') < workbook.indexOf('name="الزيارات"'));
  const summary = await zip.file('xl/worksheets/sheet2.xml').async('string'), rows = table(summary);
  assert.equal(rows[2][1], 4);
  const ratingRows = rows.filter(r => ['بربيكان', 'راني', 'بايسن'].includes(r[0]));
  assert.deepEqual(ratingRows, [['راني', 4, 2], ['بربيكان', 2.5, 2], ['بايسن', '—', 0]]);
  assert.deepEqual(rows.find(r => r[0] === 'معرفة الأصناف'), ['معرفة الأصناف', 2.5, 2]);
  assert.deepEqual(rows.find(r => r[0] === 'آرمة'), ['آرمة', 2 / 3, 1 / 3, 3]);
  assert.deepEqual(rows.find(r => r[0] === 'تصنيف'), ['تصنيف', 0.5, 0.5, 0, 0, 2]);
  assert.deepEqual(rows.find(r => r[0] === 'جودة الموقع'), ['جودة الموقع', '—', '—', '—', '—', 0]);
  for (const removed of ['اكتمال', 'بلا إجابة', 'مجموع الدرجات', 'توزيع الإجابات', 'المتوسط كنسبة']) assert(!summary.includes(removed), removed);
  const feedback = await zip.file('xl/worksheets/sheet3.xml').async('string');
  const comments = table(feedback).slice(3);
  assert.equal(comments.length, 2);
  assert.equal(comments[0][0], '=unsafe');
  assert.equal(comments[0][1], 46280);
  assert.equal(comments[0][2], 'ملاحظات المنتجات');
  assert.match(feedback, /&amp;/);
  assert(!feedback.includes('<f>'));
  assert.equal(comments[1][3], 'تعليق المندوب');
  assert.match(summary, /AVERAGE\(/);
});
test('all app rating, promotional and grade fields appear once in the insight tables', async () => {
  const app = fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8');
  const allFields = vm.runInNewContext(app.slice(app.indexOf('const sections='), app.indexOf('const fields=')) + ';sections.flatMap(s=>s.fields)');
  const zip = await JSZip.loadAsync(await (await context.api.build([{ id: 'empty', data: {} }], allFields, 'https://example.com')).arrayBuffer());
  const summary = table(await zip.file('xl/worksheets/sheet2.xml').async('string'));
  for (const [id, label, type] of allFields) if (['rating', 'yesno', 'grade'].includes(type)) {
    assert.equal(summary.filter(r => r[0] === label).length, 1, id);
  }
  assert(summary.length < 55, 'Main summary should remain compact');
});
test('empty exports and entirely unanswered questions show no misleading zero averages', async () => {
  for (const records of [[], [{ id: 'empty', data: {} }]]) {
    const zip = await JSZip.loadAsync(await (await context.api.build(records, fields, 'https://example.com')).arrayBuffer());
    const summary = await zip.file('xl/worksheets/sheet2.xml').async('string');
    assert(!/NaN|Infinity|#DIV\/0/.test(summary));
    assert.deepEqual(table(summary).find(r => r[0] === 'التقييم'), ['التقييم', '—', 0]);
    assert.match(await zip.file('xl/worksheets/sheet3.xml').async('string'), /لا توجد ملاحظات/);
  }
});
test('export uses narrow columns and compact rows while keeping long wrapped notes', async () => {
  const note = 'ملاحظة طويلة '.repeat(100);
  const zip = await JSZip.loadAsync(await (await context.api.build([{ id: 'a', data: {} }, { id: 'b', data: { notes: note } }], fields.concat([['notes', 'ملاحظات', 'textarea']]), 'https://example.com')).arrayBuffer());
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert([...sheet.matchAll(/width="([\d.]+)"/g)].every(m => Number(m[1]) <= 24));
  assert.match(sheet, /<row r="2" ht="18"/);
  assert(sheet.includes(note));
  const styles = await zip.file('xl/styles.xml').async('string');
  const xfs = styles.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)[1];
  assert.equal((xfs.match(/wrapText="1"/g) || []).length, 7);
});
