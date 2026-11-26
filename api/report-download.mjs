import {
  getDriveFolderId,
  getGoogleOAuthConfig,
  getSupabaseConfig
} from './_lib/stocktrace-config.mjs';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CASE_PATTERN = /^ST-[A-Za-z0-9_-]{5,45}$/;
const FILE_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;
const ROLES = new Set(['staff', 'leader', 'admin', 'store leader', 'store_leader']);

const json = (payload, status = 200) => Response.json(payload, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const fail = (status, code, error) => json({ ok: false, code, error }, status);
const apiError = (message, status = 500) => Object.assign(new Error(message), { status });

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
  if (!ROLES.has(role)) throw apiError('Role tidak memiliki akses mengunduh laporan Word.', 403);
  return { user, headers };
}

async function getAccessibleCase(caseId, headers, supabase) {
  const url = `${supabase.url}/rest/v1/cases?select=id_kasus&id_kasus=eq.${encodeURIComponent(caseId)}&limit=1`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw apiError('Hak akses laporan ditolak atau data kasus tidak dapat dibaca.', 403);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw apiError('Laporan tidak ditemukan atau tidak boleh diakses.', 404);
}

async function getReportRow(caseId, fileId, headers, supabase) {
  const params = new URLSearchParams({
    select: 'case_id,version,file_name,drive_file_id,drive_view_url,created_by',
    case_id: `eq.${caseId}`,
    drive_file_id: `eq.${fileId}`,
    limit: '1'
  });
  const response = await fetch(`${supabase.url}/rest/v1/stocktrace_report_documents?${params}`, { headers });
  if (!response.ok) throw apiError('Riwayat dokumen tidak dapat dibaca atau akses ditolak.', 403);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw apiError('Dokumen tidak ditemukan atau tidak boleh diakses.', 404);
  return rows[0];
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

function safeDownloadName(value) {
  const name = String(value || 'Laporan_Selisih_Stok.docx')
    .replace(/[\\/\r\n\x00-\x1f]/g, '_')
    .replace(/[";]/g, '_')
    .trim()
    .slice(0, 170);
  return name.toLowerCase().endsWith('.docx') ? name : `${name || 'Laporan_Selisih_Stok'}.docx`;
}

export default {
  async fetch(req) {
    if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Gunakan GET.');

    try {
      const authToken = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
      if (!authToken) throw apiError('Login diperlukan.', 401);

      const url = new URL(req.url);
      const caseId = String(url.searchParams.get('case_id') || '').trim();
      const fileId = String(url.searchParams.get('file_id') || '').trim();
      if (!CASE_PATTERN.test(caseId)) throw apiError('Format ID kasus tidak valid.', 400);
      if (!FILE_PATTERN.test(fileId)) throw apiError('ID file Google Drive tidak valid.', 400);

      const supabase = getSupabaseConfig();
      const { headers } = await getUserAndRole(authToken, supabase);
      await getAccessibleCase(caseId, headers, supabase);
      const report = await getReportRow(caseId, fileId, headers, supabase);

      const googleToken = await getGoogleAccessToken();
      let folderId;
      try { folderId = getDriveFolderId('r1'); }
      catch (error) { throw apiError(error.message, error.status || 503); }

      const fields = 'id,name,mimeType,size,parents,appProperties,trashed';
      const metadataUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
      const metadataResponse = await fetch(metadataUrl, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });
      const metadata = await metadataResponse.json().catch(() => ({}));
      if (!metadataResponse.ok) {
        const status = metadataResponse.status === 404 ? 404 : metadataResponse.status;
        throw apiError(`Google Drive tidak dapat memeriksa dokumen: ${metadata.error?.message || `HTTP ${status}`}`, status);
      }

      if (
        metadata.trashed ||
        metadata.mimeType !== DOCX_MIME ||
        metadata.name !== report.file_name ||
        !metadata.parents?.includes(folderId) ||
        metadata.appProperties?.stocktrace_report !== 'true' ||
        metadata.appProperties?.stocktrace_case !== caseId ||
        metadata.appProperties?.stocktrace_user !== report.created_by
      ) {
        throw apiError('Dokumen Drive tidak cocok dengan metadata laporan StockTrace.', 403);
      }

      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
      const driveResponse = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });
      if (!driveResponse.ok || !driveResponse.body) {
        const detail = await driveResponse.json().catch(() => ({}));
        const status = driveResponse.status || 502;
        throw apiError(`Google Drive gagal mengunduh dokumen: ${detail.error?.message || `HTTP ${status}`}`, status);
      }

      const fileName = safeDownloadName(report.file_name);
      const headersOut = new Headers({
        'Content-Type': DOCX_MIME,
        'Content-Disposition': `attachment; filename="Laporan_Selisih_Stok.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store, max-age=0',
        'Pragma': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      const size = Number(metadata.size);
      if (Number.isSafeInteger(size) && size >= 0) headersOut.set('Content-Length', String(size));
      return new Response(driveResponse.body, { status: 200, headers: headersOut });
    } catch (error) {
      const status = Number(error.status) || 500;
      console.error('StockTrace report-download:', status, error.message);
      return fail(status, 'REPORT_DOWNLOAD_ERROR', status === 500 ? 'Server gagal mengunduh dokumen Word. Periksa Vercel Logs.' : error.message);
    }
  }
};
