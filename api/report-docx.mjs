import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import {
  getDriveFolderId,
  getGoogleOAuthConfig,
  getSupabaseConfig
} from './_lib/stocktrace-config.mjs';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CASE_PATTERN = /^ST-[A-Za-z0-9_-]{5,45}$/;
const ROLES = new Set(['staff', 'leader', 'admin', 'store leader', 'store_leader']);
const MAX_REQUEST_BYTES = 8192;

const json = (payload, status = 200) => Response.json(payload, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const fail = (status, code, message) => json({ ok: false, code, message }, status);
const apiError = (message, status = 500) => Object.assign(new Error(message), { status });

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function readableDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long', timeStyle: 'medium', timeZone: 'Asia/Makassar'
  }).format(date) + ' WITA';
}

function safeFilePart(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 70) || 'KASUS';
}

function run(text, { bold = false, size = 22, color = '222222', italic = false } = {}) {
  const props = [
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>',
    bold ? '<w:b/>' : '',
    italic ? '<w:i/>' : '',
    `<w:color w:val="${color}"/>`,
    `<w:sz w:val="${size}"/>`
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function paragraph(text = '', options = {}) {
  const { style = '', before = 0, after = 100, align = '' } = options;
  const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}`
    + `<w:spacing w:before="${before}" w:after="${after}"/>`
    + `${align ? `<w:jc w:val="${align}"/>` : ''}`;
  return `<w:p><w:pPr>${pPr}</w:pPr>${run(text, options)}</w:p>`;
}

function labelValue(label, value) {
  return `<w:p><w:pPr><w:spacing w:after="70"/></w:pPr>${run(`${label}: `, { bold: true, size: 21 })}${run(value || '—', { size: 21 })}</w:p>`;
}

function table(rows) {
  const border = '<w:tblBorders><w:top w:val="single" w:sz="5" w:color="D9E2F3"/><w:left w:val="single" w:sz="5" w:color="D9E2F3"/><w:bottom w:val="single" w:sz="5" w:color="D9E2F3"/><w:right w:val="single" w:sz="5" w:color="D9E2F3"/><w:insideH w:val="single" w:sz="4" w:color="E6EAF0"/><w:insideV w:val="single" w:sz="4" w:color="E6EAF0"/></w:tblBorders>';
  const body = rows.map((row, index) => {
    const cells = row.map((cell, cellIndex) => {
      const header = index === 0;
      const fill = header ? '1F4E78' : (index % 2 ? 'F4F7FB' : 'FFFFFF');
      const color = header ? 'FFFFFF' : '222222';
      const content = `<w:p><w:pPr><w:spacing w:before="35" w:after="35"/></w:pPr>${run(cell, { bold: header || cellIndex === 0, size: 19, color })}</w:p>`;
      return `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/><w:shd w:fill="${fill}"/></w:tcPr>${content}</w:tc>`;
    }).join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>${border}</w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>${body}</w:tbl>`;
}

function buildDocumentXml({ caseRow, evidence, logs, version, createdAt }) {
  const c = caseRow;
  const detailRows = [
    ['Informasi', 'Nilai'],
    ['ID Kasus', c.id_kasus],
    ['Nama Produk', c.nama_produk],
    ['SKU Produk', c.sku_produk],
    ['Stok Sistem', c.stok_sistem],
    ['Stok Fisik', c.stok_fisik],
    ['Selisih Fisik − Sistem', c.selisih],
    ['Status Kasus', c.status_kasus],
    ['Pelapor (ID)', c.id_pelapor],
    ['PIC Penanganan', c.pic_nama],
    ['Tanggal Penugasan PIC', readableDate(c.pic_ditetapkan_pada)],
    ['Tanggal Laporan Dibuat', readableDate(c.created_at)]
  ];

  const evidenceContent = evidence.length
    ? evidence.map((item, index) => paragraph(`${index + 1}. ${item.nama_file_asli || 'Bukti tanpa nama'}${item.waktu_unggah ? ` — diunggah ${readableDate(item.waktu_unggah)}` : ''}${item.drive_view_url ? ` — ${item.drive_view_url}` : ''}`, { size: 19, after: 70 })).join('')
    : paragraph('Belum ada bukti pendukung yang tercatat.', { size: 20 });

  const logContent = logs.length
    ? logs.map((item, index) => paragraph(`${index + 1}. ${item.aksi || 'Aktivitas'} — ${item.catatan || 'Tidak ada catatan'} (${readableDate(item.waktu_aksi)}) · ID pengguna: ${item.id_user || '—'}`, { size: 19, after: 70 })).join('')
    : paragraph('Belum ada riwayat aktivitas yang tercatat.', { size: 20 });

  const body = [
    paragraph('LAPORAN PEMERIKSAAN SELISIH STOK', { bold: true, size: 34, color: '1F4E78', align: 'center', after: 80 }),
    paragraph('STOCKTRACE · LAPORAN R1', { bold: true, size: 20, color: '5B6573', align: 'center', after: 220 }),
    table([
      ['Keterangan Dokumen', 'Nilai'],
      ['Nomor Kasus', c.id_kasus],
      ['Versi Dokumen', String(version)],
      ['Dibuat Pada', readableDate(createdAt)]
    ]),
    paragraph('1. IDENTITAS DAN HASIL PEMERIKSAAN', { style: 'Heading1', bold: true, size: 25, color: '1F4E78', before: 240, after: 100 }),
    table(detailRows),
    paragraph('2. DUGAAN PENYEBAB', { style: 'Heading1', bold: true, size: 25, color: '1F4E78', before: 240, after: 100 }),
    paragraph(c.dugaan_penyebab || 'Belum ada dugaan penyebab yang dicatat.', { size: 21, after: 120 }),
    paragraph('3. KRONOLOGI PEMERIKSAAN', { style: 'Heading1', bold: true, size: 25, color: '1F4E78', before: 180, after: 100 }),
    paragraph(c.kronologi || 'Belum ada kronologi yang dicatat.', { size: 21, after: 120 }),
    paragraph('4. BUKTI PENDUKUNG', { style: 'Heading1', bold: true, size: 25, color: '1F4E78', before: 180, after: 100 }),
    evidenceContent,
    paragraph('5. RIWAYAT AKTIVITAS', { style: 'Heading1', bold: true, size: 25, color: '1F4E78', before: 180, after: 100 }),
    logContent,
    paragraph('Dokumen ini dibuat secara otomatis oleh StockTrace. Data pada dokumen merupakan snapshot pada saat dokumen dibuat; perubahan berikutnya pada kasus tidak mengubah versi dokumen ini.', { size: 17, color: '666666', italic: true, before: 260, after: 80 })
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipDocx(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function createDocx(data) {
  const documentXml = buildDocumentXml(data);
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:color w:val="1F4E78"/><w:sz w:val="25"/></w:rPr></w:style>`
    + `</w:styles>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
    + `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
    + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
    + `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`
    + `</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
    + `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>`
    + `</Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Laporan Pemeriksaan Selisih Stok ${xmlEscape(data.caseRow.id_kasus)}</dc:title><dc:creator>StockTrace</dc:creator></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>StockTrace</Application></Properties>`;

  return zipDocx([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRels],
    ['word/document.xml', documentXml],
    ['word/styles.xml', stylesXml],
    ['word/_rels/document.xml.rels', docRels],
    ['docProps/core.xml', core],
    ['docProps/app.xml', app]
  ]);
}

async function getUserAndRole(token, supabase) {
  if (!supabase.url || !supabase.publishableKey) throw apiError('Konfigurasi Supabase belum lengkap.', 503);
  const headers = { apikey: supabase.publishableKey, Authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${supabase.url}/auth/v1/user`, { headers });
  if (!userResponse.ok) throw apiError('Sesi login tidak valid. Silakan masuk kembali.', 401);
  const user = await userResponse.json();
  if (!user?.id) throw apiError('Akun tidak dikenal.', 401);

  const profileResponse = await fetch(`${supabase.url}/rest/v1/users?select=role&id_user=eq.${encodeURIComponent(user.id)}&limit=1`, { headers });
  if (!profileResponse.ok) throw apiError('Profil pengguna tidak dapat diperiksa.', 403);
  const profiles = await profileResponse.json();
  const role = String(profiles?.[0]?.role || '').toLowerCase().trim();
  if (!ROLES.has(role)) throw apiError('Role tidak memiliki akses membuat laporan Word.', 403);
  return { user, headers };
}

async function getAccessibleCase(caseId, headers, supabase) {
  const url = `${supabase.url}/rest/v1/cases?select=*&id_kasus=eq.${encodeURIComponent(caseId)}&limit=1`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw apiError('Hak akses laporan ditolak atau data kasus tidak dapat dibaca.', 403);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw apiError('Laporan tidak ditemukan atau tidak boleh diakses.', 404);
  return rows[0];
}

async function optionalRows(tableName, query, headers, supabase) {
  try {
    const response = await fetch(`${supabase.url}/rest/v1/${tableName}?${query}`, { headers });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function getServiceRows(path, supabase) {
  if (!supabase.serviceRoleKey) throw apiError('SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di Vercel.', 503);
  const response = await fetch(`${supabase.url}/rest/v1/${path}`, {
    headers: {
      apikey: supabase.serviceRoleKey,
      Authorization: `Bearer ${supabase.serviceRoleKey}`
    }
  });
  if (!response.ok) throw apiError('Metadata riwayat dokumen tidak dapat dibaca dari Supabase.', 502);
  return response.json();
}

async function getGoogleAccessToken() {
  const oauth = getGoogleOAuthConfig();
  if (!oauth.clientId || !oauth.clientSecret || !oauth.refreshToken) {
    throw apiError('Konfigurasi Google OAuth belum lengkap.', 503);
  }
  const body = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    const reason = String(result.error_description || result.error || `HTTP ${response.status}`).slice(0, 180);
    throw apiError(`OAuth Google gagal: ${reason}.`, 502);
  }
  return result.access_token;
}

async function uploadToDrive({ buffer, fileName, caseId, userId, version, token }) {
  let folderId;
  try { folderId = getDriveFolderId('r1'); }
  catch (error) { throw apiError(error.message, error.status || 503); }

  const folderUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`;
  const folderResponse = await fetch(folderUrl, { headers: { Authorization: `Bearer ${token}` } });
  const folder = await folderResponse.json().catch(() => ({}));
  if (!folderResponse.ok) throw apiError(`Folder Drive R1 tidak dapat diakses: ${folder.error?.message || `HTTP ${folderResponse.status}`}`, folderResponse.status);
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') throw apiError('Folder Drive R1 tidak valid atau berada di Trash.', 409);
  if (folder.capabilities?.canAddChildren === false) throw apiError('Akun OAuth tidak memiliki izin menambahkan dokumen ke folder Drive R1.', 403);

  const boundary = `stocktrace_${randomUUID().replaceAll('-', '')}`;
  const metadata = {
    name: fileName,
    mimeType: DOCX_MIME,
    parents: [folderId],
    description: `StockTrace — laporan pemeriksaan kasus ${caseId}, versi ${version}`,
    appProperties: {
      stocktrace_case: caseId,
      stocktrace_user: userId,
      stocktrace_report: 'true',
      stocktrace_version: String(version),
      stocktrace_status: 'active'
    }
  };
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${DOCX_MIME}\r\n\r\n`,
    'utf8'
  );
  const suffix = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([prefix, buffer, suffix]);
  const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,parents,appProperties,webViewLink';
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length)
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    const reason = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 220);
    throw apiError(`Google Drive gagal menyimpan dokumen Word: ${reason}`, response.status || 502);
  }
  return {
    id: data.id,
    link: data.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(data.id)}/view`
  };
}

async function deleteDriveFile(fileId, token) {
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    });
  } catch (error) {
    console.error('StockTrace report cleanup failed:', error.message);
  }
}

export default {
  async fetch(req) {
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Gunakan POST.');
    if (!(req.headers.get('content-type') || '').includes('application/json')) {
      return fail(415, 'INVALID_CONTENT_TYPE', 'Request harus menggunakan application/json.');
    }
    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > MAX_REQUEST_BYTES) return fail(413, 'REQUEST_TOO_LARGE', 'Request terlalu besar.');

    try {
      const authToken = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
      if (!authToken) throw apiError('Login diperlukan.', 401);
      const bodyText = await req.text();
      if (Buffer.byteLength(bodyText, 'utf8') > MAX_REQUEST_BYTES) throw apiError('Request terlalu besar.', 413);
      let body;
      try { body = JSON.parse(bodyText); }
      catch { throw apiError('Format JSON tidak valid.', 400); }

      const caseId = String(body.case_id || '').trim();
      if (!CASE_PATTERN.test(caseId)) throw apiError('Format ID kasus tidak valid.', 400);

      const supabase = getSupabaseConfig();
      const { user, headers } = await getUserAndRole(authToken, supabase);
      const caseRow = await getAccessibleCase(caseId, headers, supabase);

      const evidenceQuery = new URLSearchParams({
        select: 'nama_file_asli,drive_view_url,waktu_unggah,deleted_at',
        id_kasus: `eq.${caseId}`,
        deleted_at: 'is.null',
        order: 'waktu_unggah.desc',
        limit: '150'
      }).toString();
      const logsQuery = new URLSearchParams({
        select: 'id_user,aksi,catatan,waktu_aksi',
        id_kasus: `eq.${caseId}`,
        order: 'waktu_aksi.desc',
        limit: '150'
      }).toString();
      const [evidence, logs] = await Promise.all([
        optionalRows('evidence_files', evidenceQuery, headers, supabase),
        optionalRows('case_logs', logsQuery, headers, supabase)
      ]);

      const serviceRows = await getServiceRows(
        `stocktrace_report_documents?select=version&case_id=eq.${encodeURIComponent(caseId)}&order=version.desc&limit=1`,
        supabase
      );
      const version = Math.max(0, Number(serviceRows?.[0]?.version) || 0) + 1;
      const createdAt = new Date().toISOString();
      const fileName = `Laporan_Selisih_Stok_${safeFilePart(caseId)}_v${version}.docx`;
      const docx = createDocx({ caseRow, evidence, logs, version, createdAt });
      const googleToken = await getGoogleAccessToken();
      const driveFile = await uploadToDrive({
        buffer: docx, fileName, caseId, userId: user.id, version, token: googleToken
      });

      const snapshot = {
        id_kasus: caseRow.id_kasus,
        nama_produk: caseRow.nama_produk ?? null,
        sku_produk: caseRow.sku_produk ?? null,
        stok_sistem: caseRow.stok_sistem ?? null,
        stok_fisik: caseRow.stok_fisik ?? null,
        selisih: caseRow.selisih ?? null,
        dugaan_penyebab: caseRow.dugaan_penyebab ?? null,
        kronologi: caseRow.kronologi ?? null,
        status_kasus: caseRow.status_kasus ?? null,
        pic_nama: caseRow.pic_nama ?? null,
        pic_ditetapkan_pada: caseRow.pic_ditetapkan_pada ?? null,
        created_at: caseRow.created_at ?? null,
        evidence_count: evidence.length,
        log_count: logs.length
      };
      const insertResponse = await fetch(`${supabase.url}/rest/v1/stocktrace_report_documents`, {
        method: 'POST',
        headers: {
          apikey: supabase.serviceRoleKey,
          Authorization: `Bearer ${supabase.serviceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          case_id: caseId,
          version,
          file_name: fileName,
          drive_file_id: driveFile.id,
          drive_view_url: driveFile.link,
          created_by: user.id,
          snapshot
        })
      });
      if (!insertResponse.ok) {
        const detail = await insertResponse.json().catch(() => ({}));
        await deleteDriveFile(driveFile.id, googleToken);
        if (insertResponse.status === 409 || detail.code === '23505') {
          throw apiError('Versi dokumen baru saja dibuat oleh pengguna lain. Silakan klik Buat ulang dokumen sekali lagi.', 409);
        }
        console.error('StockTrace report metadata insert failed:', insertResponse.status, detail.code || detail.message || 'unknown');
        throw apiError('Dokumen sempat diunggah, tetapi metadata Supabase gagal disimpan. File sementara sudah dibersihkan; silakan coba lagi.', 502);
      }

      return json({
        ok: true,
        version,
        file_name: fileName,
        drive_file_id: driveFile.id,
        drive_view_url: driveFile.link
      });
    } catch (error) {
      const status = Number(error.status) || 500;
      console.error('StockTrace report-docx:', status, error.message);
      return fail(status, 'REPORT_DOCX_ERROR', status === 500 ? 'Server gagal membuat dokumen Word. Periksa Vercel Logs.' : error.message);
    }
  }
};
