// StockTrace V2.1 — staging Drive upload hotfix.
// Upload bytes go directly from the browser to the Google resumable session.
// Vercel handles only authenticated JSON control requests.

const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED = new Set(['jpg', 'jpeg', 'png', 'pdf', 'mp4', 'webm', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt']);
const ROLES = new Set(['staff', 'leader', 'admin', 'store leader', 'store_leader']);
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GOOGLE_DRIVE_INTAKE_FOLDER_ID'
];
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

const json = (data, status = 200) => Response.json(data, {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }
});
const fail = (code, error, status) => json({ success: false, code, error }, status);
const driveError = (message, status = 502, code = 'DRIVE_UPLOAD_ERROR') =>
  Object.assign(new Error(message), { status, code });

const validCase = id => /^ST-[A-Za-z0-9_-]{5,45}$/.test(id);
const validIntake = id => /^IN-[0-9]{8}-[A-Z0-9]{12}$/.test(id);
const validFileId = id => /^[A-Za-z0-9_-]{10,128}$/.test(id);
const validSize = size => Number.isSafeInteger(size) && size > 0 && size <= MAX_BYTES;
const cleanName = name => String(name || '')
  .replace(/[\\/\x00-\x1f<>:"|?*]/g, '_')
  .trim()
  .slice(0, 120);

function folderFor(isIntake) {
  const key = isIntake ? 'GOOGLE_DRIVE_INTAKE_FOLDER_ID' : 'GOOGLE_DRIVE_FOLDER_ID';
  const folderId = String(process.env[key] || '').trim();
  if (!folderId) throw driveError(`Environment Variable ${key} belum diisi di Vercel Preview.`, 503, 'CONFIG_MISSING');
  if (isIntake && folderId === String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim()) {
    throw driveError('Folder penerimaan dan folder laporan R1 masih memakai ID yang sama. Periksa GOOGLE_DRIVE_INTAKE_FOLDER_ID.', 503, 'FOLDER_NOT_SEPARATED');
  }
  return { key, folderId };
}

function parseGoogleError(payload) {
  const message = String(payload?.error?.message || payload?.message || 'Tidak ada detail dari Google.');
  const reason = String(payload?.error?.errors?.[0]?.reason || payload?.error?.status || 'unknown');
  return { message: message.slice(0, 700), reason: reason.slice(0, 100) };
}

async function authAndCase(req, caseId) {
  const token = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw driveError('Login diperlukan. Silakan login kembali.', 401, 'AUTH_REQUIRED');

  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const headers = {
    apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`
  };

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!authResponse.ok) throw driveError('Sesi login Supabase tidak valid atau sudah berakhir.', 401, 'AUTH_INVALID');
  const user = await authResponse.json();
  if (!user?.id) throw driveError('Akun Supabase tidak dikenali.', 401, 'AUTH_INVALID');

  const profileUrl = `${supabaseUrl}/rest/v1/users?select=role&id_user=eq.${encodeURIComponent(user.id)}&limit=1`;
  const profileResponse = await fetch(profileUrl, { headers });
  if (!profileResponse.ok) throw driveError('Profil pengguna tidak dapat diperiksa. Periksa izin baca tabel users.', 403, 'PROFILE_CHECK_FAILED');
  const profiles = await profileResponse.json();
  const role = String(profiles?.[0]?.role || '').toLowerCase().trim();
  if (!ROLES.has(role)) throw driveError('Role akun tidak memiliki izin upload bukti.', 403, 'ROLE_DENIED');

  const isIntake = validIntake(caseId);
  if (!isIntake && !validCase(caseId)) {
    throw driveError('Format ID dokumen tidak valid. Gunakan ID ST- untuk laporan atau IN- untuk penerimaan.', 400, 'INVALID_DOCUMENT_ID');
  }

  const table = isIntake ? 'stocktrace_intakes' : 'cases';
  const field = isIntake ? 'id_intake' : 'id_kasus';
  const documentUrl = `${supabaseUrl}/rest/v1/${table}?select=${field}&${field}=eq.${encodeURIComponent(caseId)}&limit=1`;
  const documentResponse = await fetch(documentUrl, { headers });
  if (!documentResponse.ok) throw driveError('Hak akses dokumen ditolak saat validasi Supabase.', 403, 'DOCUMENT_ACCESS_DENIED');
  const documents = await documentResponse.json();
  if (!Array.isArray(documents) || documents.length !== 1) {
    throw driveError('Dokumen tidak ditemukan atau akun tidak memiliki akses.', 403, 'DOCUMENT_NOT_FOUND');
  }

  return { user, isIntake };
}

async function googleToken() {
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
    const reason = String(payload.error || 'oauth_error');
    console.error('StockTrace Google OAuth refresh failed', { status: response.status, reason });
    throw driveError(`Google OAuth gagal memperbarui akses (${reason}). Periksa GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan GOOGLE_REFRESH_TOKEN di Preview.`, 502, 'GOOGLE_OAUTH_FAILED');
  }
  return {
    accessToken: payload.access_token,
    scopes: String(payload.scope || '')
  };
}

function fileInput(body) {
  const filename = cleanName(body.filename);
  const size = Number(body.size);
  const type = String(body.type || 'application/octet-stream').slice(0, 120);
  const extension = filename.split('.').pop().toLowerCase();
  if (!filename || !ALLOWED.has(extension)) throw driveError('Ekstensi berkas tidak diizinkan.', 415, 'FILE_TYPE_NOT_ALLOWED');
  if (!validSize(size)) throw driveError('Ukuran berkas harus 1 byte sampai 100 MiB.', 413, 'FILE_SIZE_INVALID');
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(type)) throw driveError('MIME type berkas tidak valid.', 415, 'MIME_TYPE_INVALID');
  return { filename, size, type };
}

async function assertDriveFolder(accessToken, folder) {
  const fields = 'id,name,mimeType,driveId,capabilities(canAddChildren)';
  const url = `${DRIVE_API}/files/${encodeURIComponent(folder.folderId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const google = parseGoogleError(payload);
    console.error('StockTrace Drive folder preflight failed', {
      status: response.status,
      reason: google.reason,
      message: google.message,
      envKey: folder.key,
      oauthScopes: undefined
    });
    if (response.status === 404) {
      throw driveError(
        `Google Drive tidak menemukan folder tujuan atau akun OAuth pada GOOGLE_REFRESH_TOKEN tidak memiliki akses ke folder itu (HTTP 404; ${google.reason}). Folder yang diperiksa: ${folder.key}. Berikan akses Editor kepada akun Google OAuth yang membuat refresh token; akun Service Account Google Sheets saja tidak cukup. Detail Google: ${google.message}`,
        404,
        'DRIVE_FOLDER_NOT_FOUND_OR_NOT_SHARED'
      );
    }
    if (response.status === 403) {
      throw driveError(
        `Google Drive menolak akses ke folder tujuan (HTTP 403; ${google.reason}). Pastikan akun OAuth pada GOOGLE_REFRESH_TOKEN memiliki akses Editor dan Drive API aktif. Detail Google: ${google.message}`,
        403,
        'DRIVE_FOLDER_PERMISSION_DENIED'
      );
    }
    throw driveError(`Pemeriksaan folder Google Drive gagal (HTTP ${response.status}; ${google.reason}): ${google.message}`, 502, 'DRIVE_FOLDER_CHECK_FAILED');
  }

  if (payload.mimeType !== DRIVE_FOLDER_MIME) {
    throw driveError(`ID pada ${folder.key} bukan folder Google Drive. Periksa ID folder dari URL /folders/...`, 400, 'DRIVE_TARGET_NOT_FOLDER');
  }
  if (payload.capabilities?.canAddChildren === false) {
    throw driveError(`Akun OAuth pada GOOGLE_REFRESH_TOKEN dapat melihat folder ${payload.name || folder.folderId}, tetapi tidak memiliki izin menambahkan file. Berikan akses Editor.`, 403, 'DRIVE_FOLDER_NOT_WRITABLE');
  }
  return payload;
}

async function startUpload(req, accessToken, user, caseId, isIntake, targetFolder, file) {
  const metadata = {
    name: `${caseId}__${file.filename}`,
    mimeType: file.type,
    parents: [targetFolder.folderId],
    description: `StockTrace — bukti ${isIntake ? 'penerimaan' : 'kasus'} ${caseId}`,
    appProperties: {
      [isIntake ? 'stocktrace_intake' : 'stocktrace_case']: caseId,
      stocktrace_user: user.id
    }
  };
  const params = new URLSearchParams({
    uploadType: 'resumable',
    supportsAllDrives: 'true',
    fields: 'id,name,mimeType,size,parents,appProperties,webViewLink'
  });
  const origin = new URL(req.url).origin;
  const response = await fetch(`${DRIVE_UPLOAD_API}?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type,
      'X-Upload-Content-Length': String(file.size),
      Origin: origin
    },
    body: JSON.stringify(metadata)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const google = parseGoogleError(payload);
    console.error('StockTrace Drive session start failed', {
      status: response.status,
      reason: google.reason,
      message: google.message,
      folderKey: targetFolder.key
    });
    throw driveError(
      `Google Drive gagal membuka sesi upload (HTTP ${response.status}; ${google.reason}). ${google.message}`,
      response.status === 403 || response.status === 404 ? response.status : 502,
      'DRIVE_SESSION_START_FAILED'
    );
  }
  const sessionUrl = response.headers.get('location');
  if (!sessionUrl || !sessionUrl.startsWith('https://www.googleapis.com/upload/drive/')) {
    throw driveError('Google tidak mengembalikan URL sesi upload yang valid.', 502, 'DRIVE_SESSION_URL_INVALID');
  }
  return json({ success: true, session_url: sessionUrl, max_file_bytes: MAX_BYTES });
}

async function verifyUpload(accessToken, user, caseId, isIntake, targetFolder, body) {
  const fileId = String(body.file_id || '');
  if (!validFileId(fileId)) throw driveError('ID file Google Drive tidak valid.', 400, 'DRIVE_FILE_ID_INVALID');
  const expected = fileInput(body);
  const fields = 'id,name,size,mimeType,parents,appProperties,trashed,webViewLink';
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const google = parseGoogleError(data);
    console.error('StockTrace Drive file verify failed', { status: response.status, reason: google.reason, message: google.message });
    throw driveError(`Google Drive belum dapat memverifikasi file (HTTP ${response.status}; ${google.reason}). ${google.message} Jangan upload ulang sebelum memeriksa folder tujuan.`, response.status === 404 ? 404 : 502, 'DRIVE_FILE_VERIFY_FAILED');
  }

  const expectedTag = isIntake ? 'stocktrace_intake' : 'stocktrace_case';
  if (
    data.trashed ||
    !Array.isArray(data.parents) ||
    !data.parents.includes(targetFolder.folderId) ||
    data.appProperties?.[expectedTag] !== caseId ||
    data.appProperties?.stocktrace_user !== user.id ||
    data.name !== `${caseId}__${expected.filename}` ||
    Number(data.size) !== expected.size
  ) {
    throw driveError('File sudah diterima Google, tetapi folder, pemilik, nama, atau ukurannya tidak cocok. Metadata database belum boleh disimpan.', 403, 'DRIVE_FILE_METADATA_MISMATCH');
  }

  return json({
    success: true,
    drive_file_id: data.id,
    drive_link: data.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(data.id)}/view`
  });
}

export default {
  async fetch(req) {
    if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Gunakan POST.', 405);

    const missing = REQUIRED_ENV.filter(key => !String(process.env[key] || '').trim());
    if (missing.length) return fail('CONFIG_MISSING', `Environment Variables Preview belum lengkap: ${missing.join(', ')}.`, 503);

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > 8192) return fail('REQUEST_TOO_LARGE', 'Request kontrol terlalu besar; file tidak boleh dikirim melalui Vercel.', 413);
    if (!(req.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      return fail('INVALID_CONTENT_TYPE', 'Endpoint ini hanya menerima JSON kontrol; file dikirim langsung ke Google Drive.', 415);
    }

    try {
      const body = await req.json();
      const action = String(body.action || '');
      const caseId = String(body.case_id || '');
      const { user, isIntake } = await authAndCase(req, caseId);
      const targetFolder = folderFor(isIntake);
      const { accessToken } = await googleToken();

      // Confirm the exact destination is visible and writable to the OAuth identity
      // used by GOOGLE_REFRESH_TOKEN. A Sheets service account is a separate identity.
      await assertDriveFolder(accessToken, targetFolder);

      if (action === 'start') {
        const file = fileInput(body);
        return await startUpload(req, accessToken, user, caseId, isIntake, targetFolder, file);
      }
      if (action === 'verify') {
        return await verifyUpload(accessToken, user, caseId, isIntake, targetFolder, body);
      }
      return fail('INVALID_ACTION', 'Gunakan action start atau verify.', 400);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      const code = error.code || 'DRIVE_UPLOAD_ERROR';
      console.error('StockTrace drive-upload failed', { status, code, message: error.message });
      return fail(code, status === 500 ? 'Server gagal memproses upload. Periksa Vercel Logs.' : error.message, status);
    }
  }
};
