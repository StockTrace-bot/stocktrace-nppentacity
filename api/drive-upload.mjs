// StockTrace V2.1 — shared production/staging integration configuration.
import { getDriveFolderId, getGoogleOAuthConfig, getSupabaseConfig } from './_lib/stocktrace-config.mjs';
// Google Drive upload uses the OAuth account that owns/has access to My Drive folders.
// Google Sheets may continue using GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON separately.
// JSON control messages only; file bytes travel directly from browser to Google Drive.

const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED = new Set([
  'jpg', 'jpeg', 'png', 'pdf', 'mp4', 'webm',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'
]);
const ROLES = new Set(['staff', 'leader', 'admin', 'store leader', 'store_leader']);

// Warm Vercel instances reuse short-lived Google OAuth tokens across uploads.
let googleTokenCache = null;
let googleTokenExpiresAt = 0;
let googleTokenCacheKey = '';
let googleTokenPending = null;
const folderAccessCache = new Map();

const json = (data, status = 200) => Response.json(data, {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }
});
const fail = (code, error, status) => json({ success: false, code, error }, status);
const driveError = (message, status = 502) => Object.assign(new Error(message), { status });

const validCase = id => /^ST-[A-Za-z0-9_-]{5,45}$/.test(id);
const validIntake = id => /^IN-[0-9]{8}-[A-Z0-9]{12}$/.test(id);
const cleanName = name => String(name || '')
  .replace(/[\\/\x00-\x1f<>:"|?*]/g, '_')
  .trim()
  .slice(0, 120);
const validFileId = id => /^[A-Za-z0-9_-]{10,128}$/.test(id);
const validSize = n => Number.isSafeInteger(n) && n > 0 && n <= MAX_BYTES;

function folderFor(isIntake) {
  try { return getDriveFolderId(isIntake ? 'intake' : 'r1'); }
  catch (error) { throw driveError(error.message, error.status || 503); }
}

async function googleToken() {
  const oauth = getGoogleOAuthConfig();
  const cacheKey = [oauth.clientId, oauth.clientSecret, oauth.refreshToken].join('\u0000');
  if (googleTokenCache && googleTokenCacheKey === cacheKey && Date.now() < googleTokenExpiresAt - 60000) {
    return googleTokenCache;
  }
  if (googleTokenPending?.key === cacheKey) return googleTokenPending.promise;

  const promise = (async () => {
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
      const reason = String(result.error_description || result.error || `HTTP ${response.status}`).slice(0, 220);
      console.error('StockTrace OAuth token refresh failed:', response.status, reason);
      throw driveError(`OAuth Google gagal: ${reason}. Pastikan refresh token berasal dari akun pemilik folder dan memiliki scope Google Drive.`, 502);
    }
    googleTokenCache = result.access_token;
    googleTokenCacheKey = cacheKey;
    googleTokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000;
    return googleTokenCache;
  })();
  googleTokenPending = { key: cacheKey, promise };
  try {
    return await promise;
  } finally {
    if (googleTokenPending?.promise === promise) googleTokenPending = null;
  }
}

async function googleDriveRequest(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
}

async function checkFolderAccess(folderId, token, label) {
  const cached = folderAccessCache.get(folderId);
  if (cached?.expiresAt > Date.now()) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const fields = 'id,name,mimeType,trashed,capabilities(canAddChildren)';
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
    const response = await googleDriveRequest(url, token);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 220);
      console.error('StockTrace OAuth Drive folder check:', { label, status: response.status, folderId, detail });
      if (response.status === 404) {
        throw driveError(`Akun OAuth tidak dapat menemukan folder ${label}. Periksa ID folder dan izin akun Google Drive. Detail Google: ${detail}`, 404);
      }
      throw driveError(`Google Drive gagal memeriksa folder ${label}: ${detail}`, response.status);
    }
    if (data.trashed) throw driveError(`Folder ${label} berada di Trash.`, 409);
    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      throw driveError(`ID tujuan ${label} bukan folder Google Drive.`, 400);
    }
    if (data.capabilities?.canAddChildren === false) {
      throw driveError(`Akun OAuth tidak memiliki izin untuk menambahkan file ke folder ${label}.`, 403);
    }
    folderAccessCache.set(folderId, { data, expiresAt: Date.now() + 120000 });
    return data;
  })();
  folderAccessCache.set(folderId, { promise, expiresAt: 0 });
  try {
    return await promise;
  } catch (error) {
    folderAccessCache.delete(folderId);
    throw error;
  }
}

async function authAndCase(req, caseId) {
  const token = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw driveError('Login diperlukan.', 401);

  const isIntake = validIntake(caseId);
  if (!validCase(caseId) && !isIntake) throw driveError('Format ID kasus/penerimaan tidak valid.', 400);

  const supabase = getSupabaseConfig();
  const supabaseOrigin = supabase.url;
  const headers = {
    apikey: supabase.publishableKey,
    Authorization: `Bearer ${token}`
  };
  const table = isIntake ? 'stocktrace_intakes' : 'cases';
  const field = isIntake ? 'id_intake' : 'id_kasus';

  // Record lookup can start while Supabase validates the access token.
  const recordPromise = fetch(
    `${supabaseOrigin}/rest/v1/${table}?select=${field}&${field}=eq.${encodeURIComponent(caseId)}&limit=1`,
    { headers }
  ).then(response => ({ response }), error => ({ error }));
  const userResponse = await fetch(`${supabaseOrigin}/auth/v1/user`, { headers });
  if (!userResponse.ok) throw driveError('Sesi login tidak valid.', 401);
  const user = await userResponse.json();
  if (!user.id) throw driveError('Akun tidak dikenal.', 401);

  // Role and record access are independent once the authenticated user is known.
  const [profileResponse, recordResult] = await Promise.all([
    fetch(`${supabaseOrigin}/rest/v1/users?select=role&id_user=eq.${encodeURIComponent(user.id)}&limit=1`, { headers }),
    recordPromise
  ]);
  if (!profileResponse.ok) throw driveError('Profil tidak bisa diperiksa.', 403);
  const profiles = await profileResponse.json();
  const role = String(profiles?.[0]?.role || '').toLowerCase().trim();
  if (!ROLES.has(role)) throw driveError('Role tidak memiliki akses upload.', 403);
  if (recordResult.error) throw driveError('Koneksi untuk memeriksa dokumen gagal.', 502);
  const recordResponse = recordResult.response;
  if (!recordResponse.ok) throw driveError('Hak akses dokumen ditolak.', 403);
  const rows = await recordResponse.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw driveError('Dokumen tidak ditemukan atau tidak boleh diakses.', 403);
  }
  return { user, isIntake };
}

function fileInput(body) {
  const filename = cleanName(body.filename);
  const size = Number(body.size);
  const type = String(body.type || 'application/octet-stream').slice(0, 120);
  const ext = filename.split('.').pop().toLowerCase();

  if (!filename || !ALLOWED.has(ext)) throw driveError('Ekstensi berkas tidak diizinkan.', 415);
  if (!validSize(size)) throw driveError('Ukuran berkas harus 1 byte sampai 100 MiB.', 413);
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(type)) throw driveError('MIME type tidak valid.', 415);

  return { filename, size, type };
}

export default {
  async fetch(req) {
    if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Gunakan POST.', 405);

    const supabase = getSupabaseConfig();
    const oauth = getGoogleOAuthConfig();
    const missing = [
      ...(!supabase.url ? ['SUPABASE_URL'] : []),
      ...(!supabase.publishableKey ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
      ...(!oauth.clientId ? ['GOOGLE_CLIENT_ID'] : []),
      ...(!oauth.clientSecret ? ['GOOGLE_CLIENT_SECRET'] : []),
      ...(!oauth.refreshToken ? ['GOOGLE_REFRESH_TOKEN'] : [])
    ];
    try { getDriveFolderId('r1'); getDriveFolderId('intake'); }
    catch (error) { missing.push(error.code || 'STOCKTRACE_INTEGRATION_TARGETS_JSON'); }
    if (missing.length) {
      return fail('CONFIG_MISSING', `Konfigurasi integrasi belum lengkap: ${[...new Set(missing)].join(', ')}`, 503);
    }

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > 8192) return fail('REQUEST_TOO_LARGE', 'Request kontrol terlalu besar.', 413);
    if (!(req.headers.get('content-type') || '').includes('application/json')) {
      return fail('INVALID_CONTENT_TYPE', 'Hanya JSON tanpa file.', 415);
    }

    try {
      const body = await req.json();
      const action = String(body.action || '');
      const caseId = String(body.case_id || '');
      if (!['start', 'verify'].includes(action)) return fail('INVALID_ACTION', 'Gunakan action start atau verify.', 400);
      if (!validCase(caseId) && !validIntake(caseId)) return fail('INVALID_CASE_ID', 'Format ID kasus/penerimaan tidak valid.', 400);
      // Validate file metadata before network/auth calls; reject oversized or invalid uploads early.
      const expectedFile = fileInput(body);
      const { user, isIntake } = await authAndCase(req, caseId);
      const google = await googleToken();

      const targetFolder = folderFor(isIntake);
      const folderLabel = isIntake ? 'penerimaan barang' : 'laporan R1';

      if (action === 'start') {
        // Folder permission is checked once per warm instance and reused briefly.
        await checkFolderAccess(targetFolder, google, folderLabel);
        const { filename, size, type } = expectedFile;
        const metadata = {
          name: `${caseId}__${filename}`,
          mimeType: type,
          parents: [targetFolder],
          description: `StockTrace — bukti ${isIntake ? 'penerimaan' : 'kasus'} ${caseId}`,
          appProperties: {
            [isIntake ? 'stocktrace_intake' : 'stocktrace_case']: caseId,
            stocktrace_user: user.id,
            stocktrace_status: 'active'
          }
        };

        const api = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,parents,appProperties,webViewLink';
        const appOrigin = new URL(req.url).origin;
        const response = await googleDriveRequest(api, google, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': type,
            'X-Upload-Content-Length': String(size),
            Origin: appOrigin
          },
          body: JSON.stringify(metadata)
        });

        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          const reason = String(detail?.error?.message || `HTTP ${response.status}`).slice(0, 220);
          console.error('StockTrace OAuth Drive session start:', response.status, reason);
          throw driveError(`Google Drive gagal membuka sesi upload: ${reason}. Periksa izin akun OAuth dan folder tujuan.`, response.status);
        }

        const sessionUrl = response.headers.get('location');
        if (!sessionUrl || !sessionUrl.startsWith('https://www.googleapis.com/upload/drive/')) {
          throw driveError('Google tidak mengembalikan URL sesi upload yang valid.');
        }

        return json({
          success: true,
          session_url: sessionUrl,
          max_file_bytes: MAX_BYTES,
        });
      }

      if (action === 'verify') {
        const fileId = String(body.file_id || '');
        if (!validFileId(fileId)) throw driveError('ID file tidak valid.', 400);

        const expected = expectedFile;
        const fields = 'id,name,size,mimeType,parents,appProperties,trashed,webViewLink';
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
        const response = await googleDriveRequest(url, google);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const reason = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 220);
          throw driveError(`Google Drive belum mengonfirmasi file: ${reason}. Jangan upload ulang sebelum mengecek Drive.`, response.status);
        }

        if (
          data.trashed ||
          !data.parents?.includes(targetFolder) ||
          data.appProperties?.[isIntake ? 'stocktrace_intake' : 'stocktrace_case'] !== caseId ||
          data.appProperties?.stocktrace_user !== user.id ||
          data.name !== `${caseId}__${expected.filename}` ||
          Number(data.size) !== expected.size
        ) {
          throw driveError('Metadata bukti tidak cocok dengan sesi upload yang diizinkan.', 403);
        }

        return json({
          success: true,
          drive_file_id: data.id,
          drive_link: data.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(data.id)}/view`,
        });
      }

      return fail('INVALID_ACTION', 'Gunakan action start atau verify.', 400);
    } catch (error) {
      const status = Number(error.status) || 500;
      console.error('StockTrace drive-upload', status, error.message);
      return fail(
        'DRIVE_UPLOAD_ERROR',
        status === 500 ? 'Server gagal memproses upload. Periksa Vercel Logs.' : error.message,
        status
      );
    }
  }
};
