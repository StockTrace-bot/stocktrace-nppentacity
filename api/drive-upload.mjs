// StockTrace V2.1 STAGING
// Direct-to-Google-Drive resumable upload.
// Drive authentication uses the existing Google service account JSON.
// The service account must have Editor access to BOTH destination folders.
// JSON control messages only; file bytes travel directly from browser to Drive.

const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED = new Set([
  'jpg', 'jpeg', 'png', 'pdf', 'mp4', 'webm',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'
]);
const ROLES = new Set(['staff', 'leader', 'admin', 'store leader', 'store_leader']);
const VARS = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GOOGLE_DRIVE_INTAKE_FOLDER_ID'
];

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
  const key = isIntake ? 'GOOGLE_DRIVE_INTAKE_FOLDER_ID' : 'GOOGLE_DRIVE_FOLDER_ID';
  const folder = String(process.env[key] || '').trim();

  if (!folder) {
    throw driveError(`Environment Variable ${key} belum diisi.`, 503);
  }

  if (isIntake && folder === String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim()) {
    throw driveError('Folder penerimaan harus berbeda dari folder bukti laporan R1.', 503);
  }

  if (!validFileId(folder)) {
    throw driveError(`${key} harus berisi ID folder Google Drive saja, bukan URL lengkap.`, 503);
  }

  return folder;
}

function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToArrayBuffer(pem) {
  const normalized = String(pem || '').replace(/\\n/g, '\n');
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  if (!body) throw driveError('private_key tidak ditemukan di GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON.', 503);

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function readServiceAccount() {
  let account;
  try {
    account = JSON.parse(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || '');
  } catch {
    throw driveError('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON bukan JSON Service Account yang valid.', 503);
  }

  if (!account?.client_email || !account?.private_key) {
    throw driveError('Service Account JSON harus memiliki client_email dan private_key.', 503);
  }

  return {
    clientEmail: String(account.client_email),
    privateKey: String(account.private_key).replace(/\\n/g, '\n'),
    tokenUri: String(account.token_uri || 'https://oauth2.googleapis.com/token')
  };
}

async function googleDriveToken() {
  const account = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: account.tokenUri,
    iat: now,
    exp: now + 3600
  };

  const encoder = new TextEncoder();
  const unsigned = [
    base64url(encoder.encode(JSON.stringify(header))),
    base64url(encoder.encode(JSON.stringify(claims)))
  ].join('.');

  let signingKey;
  try {
    signingKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToArrayBuffer(account.privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch {
    throw driveError('private_key Service Account tidak dapat dibaca. Periksa JSON di Vercel.', 503);
  }

  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, encoder.encode(unsigned))
  );
  const assertion = `${unsigned}.${base64url(signature)}`;

  const response = await fetch(account.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    const reason = String(result.error_description || result.error || `HTTP ${response.status}`).slice(0, 240);
    console.error('StockTrace service-account token exchange failed:', response.status, reason);
    throw driveError(`Autentikasi Service Account gagal: ${reason}`, 502);
  }

  return result.access_token;
}

async function driveRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  return response;
}

async function checkFolderAccess(folderId, token, label) {
  const fields = 'id,name,mimeType,trashed,capabilities(canAddChildren)';
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
  const response = await driveRequest(url, token);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const googleMessage = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 220);
    console.error('StockTrace Drive folder access check:', {
      folder: label,
      status: response.status,
      message: googleMessage
    });
    if (response.status === 404) {
      throw driveError(
        `Service Account ${readServiceAccount().clientEmail} tidak dapat menemukan/mengakses folder ${label}. Pastikan ID folder benar dan Service Account tersebut diberi akses Editor. Detail Google: ${googleMessage}`,
        404
      );
    }
    throw driveError(`Google Drive gagal memeriksa folder ${label}: ${googleMessage}`, response.status);
  }

  if (data.trashed) throw driveError(`Folder ${label} berada di Trash.`, 409);
  if (data.mimeType !== 'application/vnd.google-apps.folder') {
    throw driveError(`ID tujuan ${label} bukan folder Google Drive.`, 400);
  }
  if (data.capabilities?.canAddChildren === false) {
    throw driveError(`Service Account ${readServiceAccount().clientEmail} belum memiliki izin Editor untuk folder ${label}.`, 403);
  }

  return data;
}

async function authAndCase(req, caseId) {
  const token = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw driveError('Login diperlukan.', 401);

  const supabaseOrigin = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const headers = {
    apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`
  };

  const userResponse = await fetch(`${supabaseOrigin}/auth/v1/user`, { headers });
  if (!userResponse.ok) throw driveError('Sesi login tidak valid.', 401);

  const user = await userResponse.json();
  if (!user.id) throw driveError('Akun tidak dikenal.', 401);

  const profileResponse = await fetch(
    `${supabaseOrigin}/rest/v1/users?select=role&id_user=eq.${encodeURIComponent(user.id)}&limit=1`,
    { headers }
  );
  if (!profileResponse.ok) throw driveError('Profil tidak bisa diperiksa.', 403);

  const profiles = await profileResponse.json();
  const role = String(profiles?.[0]?.role || '').toLowerCase().trim();
  if (!ROLES.has(role)) throw driveError('Role tidak memiliki akses upload.', 403);

  const isIntake = validIntake(caseId);
  if (!validCase(caseId) && !isIntake) {
    throw driveError('Format ID kasus/penerimaan tidak valid.', 400);
  }

  const table = isIntake ? 'stocktrace_intakes' : 'cases';
  const field = isIntake ? 'id_intake' : 'id_kasus';
  const recordResponse = await fetch(
    `${supabaseOrigin}/rest/v1/${table}?select=${field}&${field}=eq.${encodeURIComponent(caseId)}&limit=1`,
    { headers }
  );

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

    const missing = VARS.filter(key => !process.env[key]);
    if (missing.length) {
      return fail('CONFIG_MISSING', `Environment Variables belum lengkap: ${missing.join(', ')}`, 503);
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
      const { user, isIntake } = await authAndCase(req, caseId);

      const targetFolder = folderFor(isIntake);
      const folderLabel = isIntake ? 'penerimaan barang' : 'laporan R1';
      const driveToken = await googleDriveToken();

      // Check exact destination folder permissions before opening an upload session.
      await checkFolderAccess(targetFolder, driveToken, folderLabel);

      if (action === 'start') {
        const { filename, size, type } = fileInput(body);
        const metadata = {
          name: `${caseId}__${filename}`,
          mimeType: type,
          parents: [targetFolder],
          description: `StockTrace — bukti ${isIntake ? 'penerimaan' : 'kasus'} ${caseId}`,
          appProperties: {
            [isIntake ? 'stocktrace_intake' : 'stocktrace_case']: caseId,
            stocktrace_user: user.id
          }
        };

        const api = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,parents,appProperties,webViewLink';
        const origin = new URL(req.url).origin;
        const response = await driveRequest(api, driveToken, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': type,
            'X-Upload-Content-Length': String(size),
            Origin: origin
          },
          body: JSON.stringify(metadata)
        });

        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          const message = String(detail?.error?.message || `HTTP ${response.status}`).slice(0, 220);
          console.error('StockTrace Drive session start:', response.status, message);
          throw driveError(`Google Drive gagal membuka sesi upload: ${message}`, response.status);
        }

        const sessionUrl = response.headers.get('location');
        if (!sessionUrl || !sessionUrl.startsWith('https://www.googleapis.com/upload/drive/')) {
          throw driveError('Google tidak mengembalikan URL sesi upload yang valid.');
        }

        return json({ success: true, session_url: sessionUrl, max_file_bytes: MAX_BYTES });
      }

      if (action === 'verify') {
        const fileId = String(body.file_id || '');
        if (!validFileId(fileId)) throw driveError('ID file tidak valid.', 400);

        const expected = fileInput(body);
        const fields = 'id,name,size,mimeType,parents,appProperties,trashed,webViewLink';
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
        const response = await driveRequest(url, driveToken);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const message = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 220);
          throw driveError(`Google Drive belum mengonfirmasi file: ${message}. Jangan upload ulang sebelum mengecek Drive.`, response.status);
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
          drive_link: data.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(data.id)}/view`
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
