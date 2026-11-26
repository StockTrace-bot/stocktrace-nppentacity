import { deflateRawSync } from 'node:zlib';

const xml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
}[ch]));

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(value, 'utf8');
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, nameBytes, compressed);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(checksum, 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBytes.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  const count = Object.keys(entries).length;
  end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralBytes, end]);
}

function run(text, { bold = false, italic = false, size = 22 } = {}) {
  const parts=String(text ?? '').split('\n');
  const content=parts.map((part,index)=>`${index?'<w:br/>':''}<w:t xml:space="preserve">${xml(part)}</w:t>`).join('');
  return `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>${content}</w:r>`;
}
function paragraph(text = '', options = {}) {
  const { align = 'left', bold = false, italic = false, size = 22, before = 0, after = 80, bottomBorder = false } = options;
  const pPr = `<w:pPr><w:spacing w:before="${before}" w:after="${after}" w:line="276" w:lineRule="auto"/>${align !== 'left' ? `<w:jc w:val="${align}"/>` : ''}${bottomBorder ? '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="3" w:color="000000"/></w:pBdr>' : ''}</w:pPr>`;
  return `<w:p>${pPr}${text === '' ? '<w:r><w:t></w:t></w:r>' : run(text, { bold, italic, size })}</w:p>`;
}
function table(rows, widths, { header = true } = {}) {
  const borders = '<w:tblBorders><w:top w:val="single" w:sz="6" w:color="000000"/><w:left w:val="single" w:sz="6" w:color="000000"/><w:bottom w:val="single" w:sz="6" w:color="000000"/><w:right w:val="single" w:sz="6" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:color="000000"/></w:tblBorders>';
  const grid = widths.map(w => `<w:gridCol w:w="${w}"/>`).join('');
  const trs = rows.map((row, ri) => `<w:tr><w:trPr><w:cantSplit/>${ri === 0 && header ? '<w:tblHeader/>' : ''}</w:trPr>${row.map((cell, ci) => {
    const text = typeof cell === 'object' && cell !== null ? cell.text : cell;
    const align = typeof cell === 'object' && cell !== null ? cell.align || 'left' : 'left';
    const bold = ri === 0 && header || Boolean(typeof cell === 'object' && cell?.bold);
    return `<w:tc><w:tcPr><w:tcW w:w="${widths[ci]}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${paragraph(text, { bold, align, size: 18, after: 20 })}</w:tc>`;
  }).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>`;
}
function section(title) { return paragraph(title, { bold: true, size: 22, before: 140, after: 50 }); }
function value(value, fallback = '—') { const s = String(value ?? '').trim(); return s || fallback; }
function wita(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', dateStyle: 'long', timeStyle: 'short' }).format(d) + ' WITA';
}

export function buildReportDocx({ report, reporterName, evidence = [], history = [], version = 1 }) {
  const caseId = value(report?.id_kasus);
  const diff = Number(report?.selisih || 0);
  const status = value(report?.status_kasus, 'Baru Dilaporkan');
  const evidenceRows = evidence.length
    ? evidence.map((f, i) => [`${i + 1}`, value(f.nama_file_asli), value(f.drive_view_url || (f.drive_file_id ? `https://drive.google.com/file/d/${f.drive_file_id}/view` : 'Tautan tidak tersedia'))])
    : [['—', 'Belum ada bukti yang dilampirkan', '—']];
  const historyText = history.length
    ? history.map(h => `${wita(h.waktu_aksi)} — ${value(h.aksi)}: ${value(h.catatan)}`).join('\n')
    : 'Belum ada tindakan lanjutan yang dicatat.';
  const body = [
    paragraph('NADA PUSPITA', { align: 'center', bold: true, size: 26, after: 20 }),
    paragraph('PENTACITY BALIKPAPAN', { align: 'center', bold: true, size: 22, after: 90, bottomBorder: true }),
    paragraph('LAPORAN SELISIH STOK BARANG', { align: 'center', bold: true, size: 30, after: 30 }),
    paragraph(`Nomor Laporan: ${caseId}  |  Versi Dokumen: ${version}`, { align: 'center', size: 18, after: 120 }),
    section('A. IDENTITAS LAPORAN'),
    table([
      [{text:'Tanggal laporan',bold:true}, wita(report?.created_at), {text:'Lokasi toko',bold:true}, 'Pentacity Balikpapan'],
      [{text:'Pelapor',bold:true}, value(reporterName), {text:'PIC penanganan',bold:true}, value(report?.pic_nama, 'Belum ditugaskan')],
      [{text:'Status laporan',bold:true}, status, {text:'Tanggal dokumen',bold:true}, wita(new Date().toISOString())],
      [{text:'Referensi penerimaan',bold:true}, value(report?.source_intake_id, 'Tidak terkait'), {text:'ID laporan',bold:true}, caseId]
    ], [1750, 3050, 1750, 3050], { header: false }),
    section('B. RINCIAN SELISIH STOK'),
    table([
      ['No.', 'SKU', 'Nama Produk', 'Stok Menurut Sistem', 'Stok Fisik', 'Selisih', 'Satuan'],
      ['1', value(report?.sku_produk), value(report?.nama_produk), String(report?.stok_sistem ?? 0), String(report?.stok_fisik ?? 0), `${diff > 0 ? '+' : ''}${diff}`, 'pcs']
    ], [500, 1350, 2450, 1500, 1200, 1200, 1400]),
    paragraph('Selisih dihitung dari stok fisik dikurangi stok menurut sistem. Nilai negatif menunjukkan kekurangan dan nilai positif menunjukkan kelebihan.', { italic: true, size: 18, before: 35, after: 60 }),
    section('C. DUGAAN PENYEBAB'),
    paragraph(value(report?.dugaan_penyebab), { size: 20, after: 80 }),
    section('D. KRONOLOGI PEMERIKSAAN'),
    paragraph(value(report?.kronologi), { size: 20, after: 80 }),
    section('E. TINDAKAN DAN TINDAK LANJUT'),
    paragraph(historyText, { size: 19, after: 80 }),
    paragraph(`Status penanganan: ${status}`, { size: 20, after: 80 }),
    section('F. BUKTI PENDUKUNG'),
    table([['No.', 'Nama berkas / jenis bukti', 'Tautan Google Drive'], ...evidenceRows], [500, 3600, 5500]),
    paragraph('Dokumen ini dibuat dari data pemeriksaan yang tercatat pada StockTrace untuk keperluan pemeriksaan dan tindak lanjut selisih stok.', { italic: true, size: 18, before: 100, after: 120 }),
    section('G. PEMERIKSAAN DAN PENGESAHAN'),
    table([
      [{text:'Dibuat oleh,\nPelapor',bold:true}, {text:'Diperiksa oleh,\nLeader',bold:true}, {text:'Disetujui oleh,\n(Jika diperlukan)',bold:true}],
      ['\n\n\n' + value(reporterName) + '\nTanggal: __________________', '\n\n\n' + value(report?.reviewerName, 'Belum diperiksa') + '\nTanggal: __________________', '\n\n\n__________________\nTanggal: __________________']
    ], [3200, 3200, 3200], { header: false })
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:color w:val="000000"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="16"/></w:rPr><w:t>StockTrace | Laporan Selisih Stok | Halaman </w:t></w:r><w:fldSimple w:instr="PAGE"/></w:p></w:ftr>`;
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
    'word/document.xml': documentXml,
    'word/styles.xml': stylesXml,
    'word/footer1.xml': footerXml,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Laporan Selisih Stok ${xml(caseId)}</dc:title><dc:creator>StockTrace</dc:creator></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>StockTrace</Application></Properties>`
  });
}
