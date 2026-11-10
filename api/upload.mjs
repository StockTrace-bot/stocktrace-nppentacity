// StockTrace — legacy small-file upload route, now uses shared integration config.
import { getDriveFolderId, getGoogleOAuthConfig, getSupabaseConfig } from './_lib/stocktrace-config.mjs';
// Nama file menentukan route: api/upload.mjs -> /api/upload
// Web-standard Request/Response, Node.js >= 20, tanpa dependency eksternal.
// Google OAuth refresh token dan kredensial tersimpan HANYA di Vercel Environment Variables.

const MAX_BYTES = 4 * 1024 * 1024; // Vercel request body maksimal 4.5 MB (termasuk multipart overhead)
const ALLOWED = new Set(['jpg', 'jpeg', 'png', 'pdf', 'mp4', 'webm', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt']);
const SUPPORTED_ROLES = new Set(['staff', 'leader', 'admin', 'store leader', 'store_leader']);

function respond(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}
function reject(code, message, status) {
  return respond({ success: false, code, error: message }, status);
}
function envMissing() {
  const supabase = getSupabaseConfig();
  const oauth = getGoogleOAuthConfig();
  const missing = [
    ...(!supabase.url ? ['SUPABASE_URL'] : []),
    ...(!supabase.publishableKey ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
    ...(!oauth.clientId ? ['GOOGLE_CLIENT_ID'] : []),
    ...(!oauth.clientSecret ? ['GOOGLE_CLIENT_SECRET'] : []),
    ...(!oauth.refreshToken ? ['GOOGLE_REFRESH_TOKEN'] : [])
  ];
  try { getDriveFolderId('r1'); } catch (error) { missing.push(error.code || 'STOCKTRACE_INTEGRATION_TARGETS_JSON'); }
  return [...new Set(missing)];
}
async function getAuthenticatedUser(request) {
  const authHeader = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return { error: 'Sesi tidak dikirim. Silakan login kembali.', status: 401 };
  const token = match[1];
  const supabase = getSupabaseConfig();
  const origin = supabase.url;
  const commonHeaders = { apikey: supabase.publishableKey, Authorization: `Bearer ${token}` };
  // Validasi user langsung ke Supabase Auth; jangan percaya role dari localStorage.
  const response = await fetch(`${origin}/auth/v1/user`, { headers: commonHeaders });
  if (!response.ok) return { error: 'Sesi Supabase tidak valid atau kedaluwarsa. Login ulang.', status: 401 };
  const user = await response.json();
  if (!user?.id) return { error: 'ID akun tidak ditemukan di Supabase Auth.', status: 401 };
  // Pastikan akun sudah menjadi staf/leader di public.users sesuai RLS yang berlaku.
  const profileUrl = `${origin}/rest/v1/users?select=role&id_user=eq.${encodeURIComponent(user.id)}&limit=1`;
  const roleResponse = await fetch(profileUrl, { headers: commonHeaders });
  if (!roleResponse.ok) return { error: 'Profil pengguna tidak dapat dibaca (cek RLS SELECT public.users).', status: 403 };
  const roles = await roleResponse.json();
  const role = String(roles?.[0]?.role || '').toLowerCase().trim();
  if (!SUPPORTED_ROLES.has(role)) return { error: 'Akun belum memiliki role staff/leader/admin yang diizinkan.', status: 403 };
  return { user, role };
}
async function getGoogleAccessToken() {
  const oauth = getGoogleOAuthConfig();
  const params = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: 'refresh_token'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.access_token) {
    console.error('OAuth token refresh gagal:', res.status, payload.error || 'no-access-token');
    throw Object.assign(new Error('Google OAuth gagal. Cek refresh token, OAuth client, dan izin Google Drive.'), { status: 502, code: 'GOOGLE_OAUTH_ERROR' });
  }
  return payload.access_token;
}
function normalizeFilename(filename) {
  return String(filename || 'berkas')
    .replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').trim().slice(0, 120) || 'berkas';
}
function caseIdSafe(str) {
  return /^ST-[A-Za-z0-9_-]{5,45}$/.test(str);
}
async function sendToDrive(file, caseId) {
  const accessToken = await getGoogleAccessToken();
  const sanitizedName = normalizeFilename(file.name);
  const metadata = {
    name: `${caseId}__${sanitizedName}`,
    parents: [getDriveFolderId('r1')],
    description: `StockTrace — bukti kasus ${caseId}`
  };
  const boundary = `stocktrace_${crypto.randomUUID().replaceAll('-', '')}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`
  ]);
  const driveResponse = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink',
    { method: 'POST', headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    }, body }
  );
  const json = await driveResponse.json().catch(() => ({}));
  if (!driveResponse.ok || !json.id) {
    console.error('Google Drive upload gagal', driveResponse.status, json.error?.code, json.error?.message);
    throw Object.assign(new Error('Google Drive menolak upload. Periksa folder ID, izin akses folder, dan Google Drive API. Detail tersedia pada Vercel Logs.'), {status: 502, code: 'GOOGLE_DRIVE_ERROR'});
  }
  return {
    drive_file_id: json.id,
    drive_link: json.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(json.id)}/view`
  };
}

export default {
  async fetch(request) {
    if (request.method === 'GET') {
      const missing = envMissing();
      // Diagnostik tidak menampilkan nilai kredensial.
      return respond({ ok: true, route: '/api/upload', configured: missing.length === 0,
        missing_settings: missing, max_file_mb: 4, message: 'Endpoint aktif. Gunakan POST multipart/form-data dari halaman login StockTrace.' });
    }
    if (request.method !== 'POST') return reject('METHOD_NOT_ALLOWED', 'Gunakan POST untuk mengunggah berkas.', 405);
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 4.4 * 1024 * 1024) {
      return reject('TOO_LARGE', 'Batas Vercel Functions 4,5 MB termasuk multipart. Pilih berkas berukuran maksimal 4 MB.', 413);
    }
    const missing = envMissing();
    if (missing.length) return reject('CONFIG_MISSING', `Konfigurasi Vercel belum lengkap: ${missing.join(', ')}. Isi Settings → Environment Variables dan deploy ulang.`, 503);
    if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
      return reject('INVALID_CONTENT_TYPE', 'Upload harus menggunakan FormData multipart/form-data.', 415);
    }
    try {
      const identity = await getAuthenticatedUser(request);
      if (identity.error) return reject('AUTH_DENIED', identity.error, identity.status);
      let form;
      try { form = await request.formData(); }
      catch (err) { return reject('BAD_MULTIPART', 'FormData tidak dapat dibaca; pastikan request berisi file.', 400); }
      const file = form.get('bukti_file');
      const caseId = String(form.get('id_kasus') || '');
      if (!file || typeof file.arrayBuffer !== 'function') return reject('NO_FILE', 'Field bukti_file harus berupa file.', 400);
      if (!caseIdSafe(caseId)) return reject('INVALID_CASE_ID', 'Format id_kasus tidak valid.', 400);
      if (file.size === 0 || file.size > MAX_BYTES) return reject('INVALID_SIZE', 'Ukuran file harus lebih dari 0 dan maksimal 4 MB.', 413);
      const extension = String(file.name || '').split('.').pop().toLowerCase();
      if (!ALLOWED.has(extension)) return reject('INVALID_TYPE', 'Format tidak diizinkan. Gunakan JPG, PNG, PDF, MP4, WEBM, DOC, DOCX, XLS, XLSX, CSV, atau TXT.', 415);
      // Kasus harus ada dan terlihat oleh akun ini (RLS): hindari bukti yatim.
      // Alur frontend membuat cases lebih dulu, kemudian upload satu per satu.
      const authToken = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
      const supabase = getSupabaseConfig();
      const origin = supabase.url;
      const visibleCaseResponse = await fetch(`${origin}/rest/v1/cases?select=id_kasus&id_kasus=eq.${encodeURIComponent(caseId)}&limit=1`, {
        headers: { apikey: supabase.publishableKey, Authorization: `Bearer ${authToken}` }
      });
      if (!visibleCaseResponse.ok) return reject('CASE_ACCESS_CHECK_FAILED','Gagal memvalidasi hak akses kasus.',403);
      const visibleCases = await visibleCaseResponse.json().catch(() => []);
      if (!Array.isArray(visibleCases) || visibleCases.length !== 1)
        return reject('CASE_NOT_FOUND','Kasus belum disimpan atau kamu tidak memiliki akses. Simpan laporan terlebih dahulu.',403);
      const result = await sendToDrive(file, caseId);
      return respond({ success: true, id_kasus: caseId, ...result, message: 'Berkas telah diterima Google Drive.' }, 200);
    } catch (error) {
      const status = error.status && [400,401,403,413,415,502,503].includes(error.status) ? error.status : 500;
      console.error('StockTrace /api/upload gagal:', error.code || 'UNEXPECTED', error.message || error);
      return reject(error.code || 'UPLOAD_SERVER_ERROR',
        status === 500 ? 'Terjadi kesalahan server. Lihat Vercel → Logs untuk rincian penyebab.' : error.message,
        status);
    }
  }
};
