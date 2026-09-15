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
  async function build(records, fields, origin) {
    if (records.length > 1048575) throw new Error('EXCEL_ROW_LIMIT');
    const headers = fields.map(f => f[1]).concat(['معرّف الزيارة', 'تاريخ الإنشاء (UTC)', 'آخر تعديل (UTC)']);
    const relations = [], links = [];
    const rows = [`<row r="1" ht="105" customHeight="1">${headers.map((h, i) => textCell(col(i) + '1', h, 1)).join('')}</row>`];
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
          return textCell(ref, 'عرض صورة المحل (تسجيل الدخول مطلوب)', 4);
        }
        if (value === undefined || value === null || value === '') return textCell(ref, '');
        if (type === 'rating' && /^[0-5]$/.test(String(value))) return numberCell(ref, Number(value));
        if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(serial(value))) return numberCell(ref, serial(value), 2);
        return textCell(ref, value);
      });
      cells.push(textCell(col(fields.length) + rowNum, r.id));
      for (const [offset, value] of [[1, r.created], [2, r.updated]]) cells.push(value && Number.isFinite(serial(value)) ? numberCell(col(fields.length + offset) + rowNum, serial(value), 3) : textCell(col(fields.length + offset) + rowNum, ''));
      rows.push(`<row r="${rowNum}" ht="60" customHeight="1">${cells.join('')}</row>`);
    }
    const range = `A1:${col(headers.length - 1)}${records.length + 1}`;
    const columns = headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${fields[i]?.[2] === 'textarea' || h.length > 28 ? 42 : fields[i]?.[2] === 'rating' ? 20 : 26}" customWidth="1"/>`).join('');
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}" xmlns:r="${relns}"><dimension ref="${range}"/><sheetViews><sheetView rightToLeft="1" showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${columns}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="${range}"/>${links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : ''}</worksheet>`;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
    zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${relns}"><bookViews><workbookView/></bookViews><sheets><sheet name="الزيارات" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relns}/styles" Target="styles.xml"/></Relationships>`);
    zip.file('xl/styles.xml', `<styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Cairo"/><color rgb="FF203F56"/></font><font><b/><sz val="11"/><name val="Cairo"/><color rgb="FFFFFFFF"/></font><font><u/><sz val="11"/><name val="Cairo"/><color rgb="FF147BAC"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF203F56"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    zip.file('xl/worksheets/sheet1.xml', sheet);
    if (relations.length) zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  return { build };
})();
