'use strict';
// Small write-only XLSX exporter. JSZip packages standard SpreadsheetML parts.
// Answers are inline strings, never formulas. Numeric scores preserve blank vs 0.
const VisitExcel = (() => {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const xml = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
  const col = index => { let result = ''; for (index++; index; index = Math.floor((index - 1) / 26)) result = String.fromCharCode(65 + (index - 1) % 26) + result; return result; };
  const serial = value => (Date.parse(value) - Date.UTC(1899, 11, 30)) / 86400000;
  function textCell(ref, value, style = 0) {
    if (String(value ?? '').length > 32767) throw new Error('EXCEL_CELL_TOO_LONG');
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }
  const numberCell = (ref, value, style = 0) => `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  const formulaCell = (ref, formula, value, style = 5) => `<c r="${ref}" s="${style}"><f>${xml(formula)}</f><v>${value}</v></c>`;
  const hasAnswer = value => value !== undefined && value !== null && String(value).trim() !== '';
  // Conservative wrapped heights; long notes remain intact and can be expanded.
  const height = (values, widths, limit = 90) => Math.min(limit, Math.max(18, ...values.map((value, i) =>
    String(value ?? '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / Math.max(6, widths[i] * 1.15))), 0) * 14 + 4)));
  // Focus the first tab on customer insights; keep verbatim feedback separately.
  function insightSheets(records, fields) {
    function sheetBuilder(widths, frozenRows = 1) {
      const rows = [], merges = [];
      const add = (values, styles = [], rowHeight) => {
        const n = rows.length + 1;
        if (n > 1048576) throw new Error('EXCEL_ROW_LIMIT');
        rows.push('<row r="' + n + '" ht="' + (rowHeight ?? height(values, widths)) + '" customHeight="1">' + values.map((value, i) => {
          const ref = col(i) + n;
          return value && typeof value === 'object' ? formulaCell(ref, value.formula, value.value, styles[i] ?? 0) : typeof value === 'number' ? numberCell(ref, value, styles[i] ?? 0) : textCell(ref, value, styles[i] ?? 0);
        }).join('') + '</row>');
        return n;
      };
      const line = (text, style = 0, rowHeight = 24) => {
        const n = add([text], [style], rowHeight);
        merges.push('A' + n + ':' + col(widths.length - 1) + n);
      };
      return {
        add, line,
        heading: title => line(title, 1),
        header: labels => add(labels, labels.map(() => 1)),
        nextRow: () => rows.length + 1,
        finish: () => '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="' + ns + '"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + col(widths.length - 1) + rows.length + '"/><sheetViews><sheetView rightToLeft="1" showGridLines="0" workbookViewId="0"><pane ySplit="' + frozenRows + '" topLeftCell="A' + (frozenRows + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>' + rows.join('') + '</sheetData>' + (merges.length ? '<mergeCells count="' + merges.length + '">' + merges.map(ref => '<mergeCell ref="' + ref + '"/>').join('') + '</mergeCells>' : '') + '<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>'
      };
    }
    const summary = sheetBuilder([44, 15, 15, 15, 15, 15]);
    const source = index => "'الزيارات'!$" + col(index) + '$2:$' + col(index) + '$' + Math.max(2, records.length + 1);
    const stats = fields.map(([id, label, type], index) => {
      const values = records.map(r => r.data[id]);
      const scores = type === 'rating' ? values.filter(v => /^[0-5]$/.test(String(v))).map(Number) : [];
      return { id, label, type, values, range: source(index), count: scores.length, average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null };
    });
    summary.heading('Leaders Of Grandness — ملخص المنتجات وآراء الزبائن');
    summary.line('النتائج تخص الزيارات المصدّرة؛ قد تتكرر زيارة الزبون نفسه.');
    const dates = records.map(r => r.data.date).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v || '')).sort();
    summary.add(['عدد الزيارات', records.length, 'أول زيارة', dates[0] || '—', 'آخر زيارة', dates[dates.length - 1] || '—']);
    summary.line('المتوسطات والنسب تستبعد الفراغ والقيم غير الصالحة؛ التقييم صفر يُحتسب.');
    const ratingSection = (title, items) => {
      if (!items.length) return;
      summary.heading(title);
      summary.header(['المؤشر / المنتج', 'المتوسط من 5', 'عدد الردود']);
      for (const s of items) summary.add([s.label, s.count ? { formula: 'IFERROR(AVERAGE(' + s.range + '),0)', value: s.average } : '—',
        { formula: 'COUNT(' + s.range + ')', value: s.count }], [0, 6, 0]);
    };
    const products = stats.filter(s => s.type === 'rating' && /^product\d+$/.test(s.id));
    products.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
    ratingSection('المنتجات — من الأعلى إلى الأقل تقييماً', products);
    ratingSection('معرفة الزبون بأصناف الشركة', stats.filter(s => s.type === 'rating' && s.id === 'knows'));
    ratingSection('أداء المندوبين والعروض والفواتير', stats.filter(s => s.type === 'rating' && !/^product\d+$/.test(s.id) && !['knows', 'placement'].includes(s.id)));
    ratingSection('موقع منتجاتنا على الرفوف وفي البرادات', stats.filter(s => s.type === 'rating' && s.id === 'placement'));
    const categoryCounts = (stat, options) => {
      // COUNTIF is case-insensitive, so use the same rule for cached Excel results.
      const counts = options.map(option => stat.values.filter(v => String(v ?? '').toUpperCase() === option.toUpperCase()).length);
      return { counts, count: counts.reduce((a, b) => a + b, 0), formula: options.map(option => 'COUNTIF(' + stat.range + ',"' + option + '")').join('+') };
    };
    const yesno = stats.filter(s => s.type === 'yesno');
    if (yesno.length) {
      summary.heading('توفر المواد الدعائية لدى الزبائن');
      summary.header(['المادة الدعائية', 'متوفرة %', 'غير متوفرة %', 'عدد الردود']);
      for (const s of yesno) {
        const options = ['نعم', 'لا'], data = categoryCounts(s, options), n = summary.nextRow();
        summary.add([s.label, ...options.map((option, i) => data.count ? {
          formula: 'IF(D' + n + '=0,0,COUNTIF(' + s.range + ',"' + option + '")/D' + n + ')', value: data.counts[i] / data.count
        } : '—'), { formula: data.formula, value: data.count }], [0, 5, 5, 0]);
      }
    }
    const grades = stats.filter(s => s.type === 'grade');
    if (grades.length) {
      summary.heading('تصنيف الزبائن وجودة المواقع');
      summary.header(['المؤشر', 'A %', 'B %', 'C %', 'D %', 'عدد الردود']);
      for (const s of grades) {
        const options = ['A', 'B', 'C', 'D'], data = categoryCounts(s, options), n = summary.nextRow();
        summary.add([s.label, ...options.map((option, i) => data.count ? {
          formula: 'IF(F' + n + '=0,0,COUNTIF(' + s.range + ',"' + option + '")/F' + n + ')', value: data.counts[i] / data.count
        } : '—'), { formula: data.formula, value: data.count }], [0, 5, 5, 5, 5, 0]);
      }
    }
    summary.line('التعليقات المكتوبة مع اسم الزبون وتاريخ الزيارة في صفحة «ملاحظات الزبائن».');
    summary.line('— تعني عدم وجود ردود صالحة. ترتيب المنتجات يعكس وقت التصدير؛ أعد التصدير لتحديثه.');
    const feedback = sheetBuilder([24, 12, 30, 60], 3);
    feedback.heading('Leaders Of Grandness — ملاحظات الزبائن');
    feedback.line('تعليقات الزبائن كما أُدخلت. وسّع الصف لقراءة الملاحظات الطويلة كاملة.');
    feedback.header(['اسم الزبون', 'تاريخ الزيارة', 'موضوع الملاحظة', 'نص الملاحظة']);
    let noteCount = 0;
    for (const r of records) for (const [id, label, type] of fields) {
      if (type !== 'textarea' || !hasAnswer(r.data[id])) continue;
      const date = r.data.date, validDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(serial(date));
      feedback.add([hasAnswer(r.data.customer) ? r.data.customer : 'غير مسمى', validDate ? serial(date) : date || '—', label, r.data[id]], [0, validDate ? 2 : 0, 0, 0]);
      noteCount++;
    }
    if (!noteCount) feedback.line('لا توجد ملاحظات مكتوبة ضمن الزيارات المصدّرة.');
    return { summary: summary.finish(), feedback: feedback.finish() };
  }
  async function build(records, fields, origin) {
    if (records.length > 1048575) throw new Error('EXCEL_ROW_LIMIT');
    const headers = fields.map(f => f[1]).concat(['معرّف الزيارة', 'تاريخ الإنشاء (UTC)', 'آخر تعديل (UTC)']);
    const widths = headers.map((h, i) => ({ rating: 12, yesno: 10, grade: 12, date: 12, textarea: 24, photo: 16, gps: 18 }[fields[i]?.[2]] || (i >= fields.length ? 16 : 18)));
    const relations = [], links = [];
    const rows = [`<row r="1" ht="${height(headers, widths, 105)}" customHeight="1">${headers.map((h, i) => textCell(col(i) + '1', h, 1)).join('')}</row>`];
    for (let i = 0; i < records.length; i++) {
      const r = records[i], rowNum = i + 2;
      const cells = fields.map(([id, label, type], j) => {
        const ref = col(j) + rowNum, value = r.data[id];
        if (type === 'photo') {
          if (!r.photoPath && !r.data.photo) return textCell(ref, '');
          const target = new URL('/', origin); target.searchParams.set('visit', r.id);
          const rid = 'rId' + (relations.length + 1);
          relations.push(`<Relationship Id="${rid}" Type="${relns}/hyperlink" Target="${xml(target.href)}" TargetMode="External"/>`);
          links.push(`<hyperlink ref="${ref}" r:id="${rid}"/>`);
          return textCell(ref, 'عرض الصورة', 4);
        }
        if (value === undefined || value === null || value === '') return textCell(ref, '');
        if (type === 'rating' && /^[0-5]$/.test(String(value))) return numberCell(ref, Number(value));
        if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(serial(value))) return numberCell(ref, serial(value), 2);
        return textCell(ref, value);
      });
      cells.push(textCell(col(fields.length) + rowNum, r.id));
      for (const [offset, value] of [[1, r.created], [2, r.updated]]) cells.push(value && Number.isFinite(serial(value)) ? numberCell(col(fields.length + offset) + rowNum, serial(value), 3) : textCell(col(fields.length + offset) + rowNum, ''));
      const visibleValues = fields.map(([id, label, type]) => type === 'photo' ? (r.photoPath || r.data.photo ? 'عرض الصورة' : '') : r.data[id]).concat([r.id, r.created ? 'yyyy-mm-dd hh:mm:ss' : '', r.updated ? 'yyyy-mm-dd hh:mm:ss' : '']);
      rows.push(`<row r="${rowNum}" ht="${height(visibleValues, widths)}" customHeight="1">${cells.join('')}</row>`);
    }
    const range = `A1:${col(headers.length - 1)}${records.length + 1}`;
    const columns = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}" xmlns:r="${relns}"><dimension ref="${range}"/><sheetViews><sheetView rightToLeft="1" showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="${range}"/>${links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : ''}</worksheet>`;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
    zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${relns}"><bookViews><workbookView/></bookViews><sheets><sheet name="الملخص" sheetId="2" r:id="rId3"/><sheet name="ملاحظات الزبائن" sheetId="3" r:id="rId4"/><sheet name="الزيارات" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relns}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${relns}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId4" Type="${relns}/worksheet" Target="worksheets/sheet3.xml"/></Relationships>`);
    zip.file('xl/styles.xml', `<styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Cairo"/><color rgb="FF203F56"/></font><font><b/><sz val="10"/><name val="Cairo"/><color rgb="FFFFFFFF"/></font><font><u/><sz val="10"/><name val="Cairo"/><color rgb="FF147BAC"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF203F56"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    zip.file('xl/worksheets/sheet1.xml', sheet);
    const insights = insightSheets(records, fields);
    zip.file('xl/worksheets/sheet2.xml', insights.summary);
    zip.file('xl/worksheets/sheet3.xml', insights.feedback);
    if (relations.length) zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  return { build };
})();
