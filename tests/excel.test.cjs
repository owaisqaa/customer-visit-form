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
