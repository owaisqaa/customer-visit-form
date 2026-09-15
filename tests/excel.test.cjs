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
test('summary counts every field, includes zero in averages, and distinguishes percentage bases', async () => {
  const allFields = fields.concat([['display', 'آرمة', 'yesno'], ['grade', 'تصنيف', 'grade'], ['notes', 'ملاحظات', 'textarea']]);
  const records = [
    { id: 'a', data: { customer: '=unsafe', score: '0', display: 'نعم', grade: 'A', notes: 'ملاحظة' }, photoPath: 'private/a' },
    { id: 'b', data: { customer: '=unsafe', score: '5', display: 'لا', grade: 'B' } },
    { id: 'c', data: { score: 'invalid', display: 'نعم' } },
    { id: 'd', data: {} }
  ];
  const zip = await JSZip.loadAsync(await (await context.api.build(records, allFields, 'https://example.com')).arrayBuffer());
  const workbook = await zip.file('xl/workbook.xml').async('string');
  assert(workbook.indexOf('name="الملخص"') < workbook.indexOf('name="الزيارات"'));
  const summary = await zip.file('xl/worksheets/sheet2.xml').async('string'), rows = table(summary);
  assert.equal(rows[2][2], 4);
  const completion = rows.slice(8, 8 + allFields.length);
  assert.deepEqual(completion.map(r => r[0]), allFields.map(f => f[1]));
  assert.deepEqual(completion.find(r => r[0] === 'التقييم').slice(1), [3, 1, 0.75, 2, 2.5, 0.5, 5]);
  assert.deepEqual(completion.find(r => r[0] === 'صورة المحل').slice(1, 4), [1, 3, 0.25]);
  assert.deepEqual(completion.find(r => r[0] === 'ملاحظات').slice(1, 4), [1, 3, 0.25]);
  assert.deepEqual(rows.find(r => r[0] === 'آرمة' && r[1] === 'نعم').slice(2), [2, 2 / 3, 0.5]);
  assert.deepEqual(rows.find(r => r[0] === 'آرمة' && r[1] === 'بلا إجابة').slice(2), [1, '', 0.25]);
  for (const [id, label] of allFields) {
    const breakdown = rows.filter(r => r[0] === label && typeof r[1] === 'string');
    assert.equal(breakdown.reduce((n, r) => n + r[2], 0), 4, label);
    assert.equal(breakdown.reduce((n, r) => n + r[4], 0), 1, label);
  }
  assert(!summary.includes('<f>=unsafe'));
  assert(summary.includes('=unsafe'));
});
test('empty exports and entirely unanswered ratings never produce invalid statistics', async () => {
  for (const records of [[], [{ id: 'empty', data: {} }]]) {
    const zip = await JSZip.loadAsync(await (await context.api.build(records, fields, 'https://example.com')).arrayBuffer());
    const summary = await zip.file('xl/worksheets/sheet2.xml').async('string');
    assert(!/NaN|Infinity|#DIV\/0/.test(summary));
    assert.equal(table(summary).find(r => r[0] === 'التقييم')[5], '');
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
