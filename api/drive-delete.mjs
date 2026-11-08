// StockTrace V2.1 — delete Drive evidence after an authenticated Supabase DELETE webhook.
// This endpoint only moves verified StockTrace evidence to Drive Trash; it never permanently deletes.
import { timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024;
const TABLES = {
  evidence_files: {
    idField: 'id_kasus',
    folderEnv: 'GOOGLE_DRIVE_FOLDER_ID',
    appProperty: 'stocktrace_case',
    idPattern: /^ST-[A-Za-z0-9_-]{5,45}$/,
    label: 'bukti kasus R1'
  },
  stocktrace_intake_evidence: {
    idField: 'id_intake',
    folderEnv: 'GOOGLE_DRIVE_INTAKE_FOLDER_ID',
    appProperty: 'stocktrace_intake',
    idPattern: /^IN-[0-9]{8}-[A-Z0-9]{12}$/,
    label: 'bukti penerimaan'
  }
};
const REQUIRED_ENV = [
  'STOCKTRACE_SHEETS_WEBHOOK_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GOOGLE_DRIVE_INTAKE_FOLDER_ID'
];
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

const json = (payload, status = 200) => Response.json(payload, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const fail = (code, message, status) => json({ ok: false, code, message }, status);

function secretMatches(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string' || !received || !expected) return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function folderFor(tableConfig) {
  const folder = String(process.env[tableConfig.folderEnv] || '').trim();
  if (!FILE_ID_PATTERN.test(folder)) {
    throw Object.assign(new Error(`Environment Variable ${tableConfig.folderEnv} belum valid.`), { status: 503, code: 'DRIVE_FOLDER_CONFIG' });
  }
  const caseFolder = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  const intakeFolder = String(process.env.GOOGLE_DRIVE_INTAKE_FOLDER_ID || '').trim();
  if (caseFolder === intakeFolder) {
    throw Object.assign(new Error('Folder bukti R1 dan penerimaan harus berbeda.'), { status: 503, code: 'DRIVE_FOLDER_COLLISION' });
  }
  return folder;
}

async function googleAccessToken() {
  const form = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const reason = String(payload.error || `HTTP ${response.status}`).slice(0, 160);
    throw Object.assign(new Error(`Google OAuth gagal: ${reason}`), { status: 502, code: 'GOOGLE_OAUTH_FAILED' });
  }
  return payload.access_token;
}

async function driveRequest(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Gunakan POST.', 405);

    const missing = REQUIRED_ENV.filter(name => !process.env[name]);
    if (missing.length) return fail('CONFIG_MISSING', `Environment Variables belum lengkap: ${missing.join(', ')}.`, 503);

    const length = Number(request.headers.get('content-length') || 0);
    if (length > MAX_BODY_BYTES) return fail('BODY_TOO_LARGE', 'Payload webhook terlalu besar.', 413);
    if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      return fail('INVALID_CONTENT_TYPE', 'Webhook harus mengirim application/json.', 415);
    }

    if (!secretMatches(
      request.headers.get('x-stocktrace-sync-secret') || '',
      process.env.STOCKTRACE_SHEETS_WEBHOOK_SECRET
    )) return fail('UNAUTHORIZED', 'Webhook tidak terautentikasi.', 401);

    try {
      let body;
      try { body = await request.json(); }
      catch { return fail('BAD_JSON', 'Payload webhook bukan JSON valid.', 400); }

      if (body?.schema !== 'public' || body?.type !== 'DELETE' || !TABLES[body?.table]) {
        return fail('EVENT_NOT_SUPPORTED', 'Hanya event DELETE pada tabel bukti StockTrace yang diterima.', 400);
      }

      const config = TABLES[body.table];
      const record = body.old_record;
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return fail('OLD_RECORD_MISSING', 'Payload DELETE tidak memuat old_record.', 400);
      }

      const recordId = String(record[config.idField] || '').trim();
      if (!config.idPattern.test(recordId)) return fail('RECORD_ID_INVALID', 'ID kasus/penerimaan pada old_record tidak valid.', 400);

      const fileId = String(record.drive_file_id || '').trim();
      if (!fileId) return json({ ok: true, kind: 'drive_delete', table: body.table, action: 'no_drive_file_id' });
      if (!FILE_ID_PATTERN.test(fileId)) return fail('FILE_ID_INVALID', 'ID file Google Drive tidak valid.', 400);

      const folderId = folderFor(config);
      const token = await googleAccessToken();
      const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
      metadataUrl.searchParams.set('fields', 'id,name,description,parents,trashed,appProperties');
      metadataUrl.searchParams.set('supportsAllDrives', 'true');
      const metadataResponse = await driveRequest(metadataUrl.toString(), token);

      // Idempotent: a missing or already-trashed file is already in the desired state.
      if (metadataResponse.status === 404 || metadataResponse.status === 410) {
        return json({ ok: true, kind: 'drive_delete', table: body.table, action: 'already_missing' });
      }
      const metadata = await metadataResponse.json().catch(() => ({}));
      if (!metadataResponse.ok) {
        throw Object.assign(new Error(`Google Drive gagal memeriksa file (HTTP ${metadataResponse.status}).`), {
          status: metadataResponse.status === 403 ? 403 : 502,
          code: 'DRIVE_METADATA_FAILED'
        });
      }
      if (metadata.trashed) {
        return json({ ok: true, kind: 'drive_delete', table: body.table, action: 'already_trashed' });
      }

      const expectedProperty = metadata.appProperties?.[config.appProperty];
      const expectedPrefix = `${recordId}__`;
      const validStockTraceName = String(metadata.name || '').startsWith(expectedPrefix);
      const validDescription = String(metadata.description || '').includes('StockTrace');
      const validProperty = expectedProperty === undefined || expectedProperty === recordId;
      const validParent = Array.isArray(metadata.parents) && metadata.parents.includes(folderId);
      if (!validParent || !validStockTraceName || !validDescription || !validProperty) {
        console.error('StockTrace Drive delete refused: metadata mismatch', {
          table: body.table,
          fileId,
          recordId,
          parentMatches: validParent,
          nameMatches: validStockTraceName,
          descriptionMatches: validDescription,
          appPropertyMatches: validProperty
        });
        return fail('DRIVE_FILE_NOT_OWNED', 'File tidak cocok dengan folder dan metadata StockTrace; penghapusan dibatalkan.', 403);
      }

      const trashUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
      trashUrl.searchParams.set('supportsAllDrives', 'true');
      trashUrl.searchParams.set('fields', 'id,trashed');
      const trashResponse = await driveRequest(trashUrl.toString(), token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true })
      });
      const trashed = await trashResponse.json().catch(() => ({}));
      if (!trashResponse.ok || trashed.trashed !== true) {
        throw Object.assign(new Error(`Google Drive gagal memindahkan file ke Bin (HTTP ${trashResponse.status}).`), {
          status: 502,
          code: 'DRIVE_TRASH_FAILED'
        });
      }

      return json({ ok: true, kind: 'drive_delete', table: body.table, action: 'moved_to_trash' });
    } catch (error) {
      const status = Number(error.status) || 502;
      console.error('StockTrace Drive DELETE failed:', error.code || 'UNEXPECTED', error.message);
      return fail(error.code || 'DRIVE_DELETE_FAILED',
        status === 500 ? 'Server gagal memproses penghapusan Drive. Periksa Vercel Logs.' : error.message,
        status);
    }
  }
};
