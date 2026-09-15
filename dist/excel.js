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
  function summarySheet(records, fields) {
    const rows = [], merges = [], widths = [34, 24, 12, 14, 14, 14, 14, 14];
    const add = (values, styles = [], rowHeight) => {
      const n = rows.length + 1;
      if (n > 1048576) throw new Error('EXCEL_ROW_LIMIT');
      rows.push(`<row r="${n}" ht="${rowHeight ?? height(values, widths, 60)}" customHeight="1">${values.map((value, i) => {
        const ref = col(i) + n;
        return value && typeof value === 'object' ? formulaCell(ref, value.formula, value.value, styles[i] ?? 5) : typeof value === 'number' ? numberCell(ref, value, styles[i] ?? 0) : textCell(ref, value, styles[i] ?? 0);
      }).join('')}</row>`);
      return n;
    };
    const heading = title => { const n = add([title], [1], 24); merges.push(`A${n}:H${n}`); };
    const header = labels => add(labels, labels.map(() => 1));
    const ratio = (numerator, denominator, formula) => ({ formula, value: denominator ? numerator / denominator : 0 });
    const total = records.length;
    heading('Leaders Of Grandness — ملخص الزيارات');
    const note = 'ملخص لقطة البيانات المصدّرة فقط؛ تصدير الفترة يشمل زيارات الفترة المختارة.';
    const noteRow = add([note], [], 24); merges.push(`A${noteRow}:H${noteRow}`);
    add(['عدد الزيارات المصدّرة', '', total]);
    const dates = records.map(r => r.data.date).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v || '')).sort();
    add(['أول تاريخ زيارة', dates[0] || '—', '', 'آخر تاريخ زيارة', dates[dates.length - 1] || '—']);
    add(['زيارات بلا تاريخ', '', records.filter(r => !hasAnswer(r.data.date)).length]);
    heading('اكتمال كل سؤال ومتوسطات التقييم');
    const explanation = add(['النسب من الزيارات المصدّرة. المتوسط يستبعد الفراغ والقيم غير الصالحة ويشمل الصفر.'], [], 24);
    merges.push(`A${explanation}:H${explanation}`);
    header(['السؤال', 'تمت الإجابة', 'بلا إجابة', 'نسبة\nالاكتمال', 'تقييمات\nصالحة', 'المتوسط\nمن 5', 'المتوسط\nكنسبة', 'مجموع\nالدرجات']);
    const stats = fields.map(([id, label, type]) => {
      const values = records.map(r => type === 'photo' ? (r.photoPath || r.data.photo ? 'مرفقة' : '') : r.data[id]);
      const answered = values.filter(hasAnswer), scores = type === 'rating' ? answered.filter(v => /^[0-5]$/.test(String(v))).map(Number) : [];
      const sum = scores.reduce((a, b) => a + b, 0), n = rows.length + 1;
      const mean = scores.length ? { formula: `H${n}/E${n}`, value: sum / scores.length } : '';
      add([label, answered.length, total - answered.length, ratio(answered.length, total, `IF($C$3=0,0,B${n}/$C$3)`), type === 'rating' ? scores.length : '', mean,
        scores.length ? ratio(sum / scores.length, 5, `F${n}/5`) : '', type === 'rating' ? sum : ''], [0, 0, 0, 5, 0, 6, 5, 0]);
      return { label, type, answered, missing: total - answered.length, row: n };
    });
    heading('توزيع الإجابات — عدد ونسبة لكل خيار');
    const detailNote = add(['النسبة من الإجابات تستبعد الفراغ؛ النسبة من الزيارات تشمل الجميع. الملاحظات وGPS والصور: توفر المعلومة فقط.'], [], 24);
    merges.push(`A${detailNote}:H${detailNote}`);
    header(['السؤال', 'الإجابة', 'العدد', '% من\nالإجابات', '% من\nالزيارات']);
    for (const stat of stats) {
      const { label, type, answered, missing, row } = stat;
      const presence = ['textarea', 'gps', 'photo'].includes(type);
      const options = type === 'rating' ? ['0', '1', '2', '3', '4', '5'] : type === 'grade' ? ['A', 'B', 'C', 'D'] : type === 'yesno' ? ['نعم', 'لا'] : presence ? ['متوفرة'] : [];
      const counts = new Map(options.map(value => [value, 0]));
      for (const value of answered) {
        const key = presence ? 'متوفرة' : String(value).trim();
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const entries = [...counts];
      if (!options.length) entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'));
      entries.push(['بلا إجابة', missing, true]);
      for (const [answer, count, blank] of entries) {
        const n = rows.length + 1;
        add([label, answer, count, blank ? '' : ratio(count, answered.length, `IF(B${row}=0,0,C${n}/B${row})`), ratio(count, total, `IF($C$3=0,0,C${n}/$C$3)`)], [0, 0, 0, 5, 5]);
      }
    }
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:H${rows.length}"/><sheetViews><sheetView rightToLeft="1" showGridLines="0" workbookViewId="0"><pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
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
    zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
    zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${relns}"><bookViews><workbookView/></bookViews><sheets><sheet name="الملخص" sheetId="2" r:id="rId3"/><sheet name="الزيارات" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relns}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${relns}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`);
    zip.file('xl/styles.xml', `<styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Cairo"/><color rgb="FF203F56"/></font><font><b/><sz val="10"/><name val="Cairo"/><color rgb="FFFFFFFF"/></font><font><u/><sz val="10"/><name val="Cairo"/><color rgb="FF147BAC"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF203F56"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    zip.file('xl/worksheets/sheet1.xml', sheet);
    zip.file('xl/worksheets/sheet2.xml', summarySheet(records, fields));
    if (relations.length) zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  return { build };
})();
