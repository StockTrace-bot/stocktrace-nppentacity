// StockTrace V2.2.1 — reversible Drive archive-folder move/restore plus verified DELETE-to-Trash.
// Archived evidence is moved out of the active upload folder into a managed subfolder:
// "ARSIP STOCKTRACE". Restore moves the same file back; no file bytes are copied or deleted.
import { timingSafeEqual } from 'node:crypto';
import { getDriveFolderId, getGoogleOAuthConfig, getWebhookSecret } from './_lib/stocktrace-config.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const ARCHIVE_FOLDER_NAME = 'ARSIP STOCKTRACE';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const TABLES = {
  evidence_files: {
    idField: 'id_kasus',
    folderKind: 'r1',
    appProperty: 'stocktrace_case',
    archiveKind: 'case_evidence',
    idPattern: /^ST-[A-Za-z0-9_-]{5,45}$/,
    label: 'bukti kasus R1'
  },
  stocktrace_intake_evidence: {
    idField: 'id_intake',
    folderKind: 'intake',
    appProperty: 'stocktrace_intake',
    archiveKind: 'intake_evidence',
    idPattern: /^IN-[0-9]{8}-[A-Z0-9]{12}$/,
    label: 'bukti penerimaan'
  }
};
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
  try { return getDriveFolderId(tableConfig.folderKind); }
  catch (error) { throw Object.assign(new Error(error.message), { status: error.status || 503, code: error.code || 'DRIVE_FOLDER_CONFIG' }); }
}

function driveFailure(code, message, status = 502) {
  return Object.assign(new Error(message), { status, code });
}

async function googleAccessToken() {
  const oauth = getGoogleOAuthConfig();
  const form = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken,
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
    throw driveFailure('GOOGLE_OAUTH_FAILED', `Google OAuth gagal: ${reason}`, 502);
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

async function readDriveJson(response, code, label) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status === 403 ? 403 : response.status === 404 ? 404 : 502;
    throw driveFailure(code, `${label} gagal (HTTP ${response.status}).`, status);
  }
  return payload;
}

// Create the archive subfolder on first use. The folder is kept inside its matching
// active evidence folder, so R1 and Penerimaan remain separate. A same-name folder
// that was not created/marked by StockTrace is never adopted automatically.
async function findOrCreateArchiveFolder(parentId, token, archiveKind) {
  const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
  listUrl.searchParams.set('q', `'${parentId}' in parents and name = '${ARCHIVE_FOLDER_NAME}' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`);
  listUrl.searchParams.set('pageSize', '100');
  listUrl.searchParams.set('fields', 'files(id,name,mimeType,parents,appProperties)');
  listUrl.searchParams.set('supportsAllDrives', 'true');
  listUrl.searchParams.set('includeItemsFromAllDrives', 'true');
  const listResponse = await driveRequest(listUrl.toString(), token);
  const listing = await readDriveJson(listResponse, 'DRIVE_ARCHIVE_FOLDER_LOOKUP_FAILED', 'Pemeriksaan folder arsip');
  const matches = (Array.isArray(listing.files) ? listing.files : []).filter(file =>
    file.name === ARCHIVE_FOLDER_NAME && file.mimeType === DRIVE_FOLDER_MIME &&
    Array.isArray(file.parents) && file.parents.includes(parentId)
  );

  if (matches.length > 1) {
    throw driveFailure('DRIVE_ARCHIVE_FOLDER_DUPLICATE', `Ditemukan lebih dari satu folder ${ARCHIVE_FOLDER_NAME}. Rapikan folder duplikat sebelum melanjutkan.`, 409);
  }
  if (matches.length === 1) {
    const folder = matches[0];
    const props = folder.appProperties || {};
    if (props.stocktrace_archive_folder !== 'true' ||
        props.stocktrace_archive_parent !== parentId ||
        props.stocktrace_archive_kind !== archiveKind) {
      throw driveFailure('DRIVE_ARCHIVE_FOLDER_CONFLICT', `Folder bernama ${ARCHIVE_FOLDER_NAME} sudah ada tetapi bukan folder arsip yang dibuat StockTrace. Ubah nama folder tersebut agar tidak tercampur dengan arsip aplikasi.`, 409);
    }
    if (!FILE_ID_PATTERN.test(String(folder.id || ''))) {
      throw driveFailure('DRIVE_ARCHIVE_FOLDER_INVALID', 'ID folder arsip Google Drive tidak valid.', 502);
    }
    return folder.id;
  }

  const createUrl = new URL('https://www.googleapis.com/drive/v3/files');
  createUrl.searchParams.set('supportsAllDrives', 'true');
  createUrl.searchParams.set('fields', 'id,name,mimeType,parents,appProperties');
  const createResponse = await driveRequest(createUrl.toString(), token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: ARCHIVE_FOLDER_NAME,
      mimeType: DRIVE_FOLDER_MIME,
      parents: [parentId],
      appProperties: {
        stocktrace_archive_folder: 'true',
        stocktrace_archive_parent: parentId,
        stocktrace_archive_kind: archiveKind
      }
    })
  });
  const created = await readDriveJson(createResponse, 'DRIVE_ARCHIVE_FOLDER_CREATE_FAILED', 'Pembuatan folder arsip');
  if (!FILE_ID_PATTERN.test(String(created.id || '')) ||
      created.mimeType !== DRIVE_FOLDER_MIME ||
      !Array.isArray(created.parents) || !created.parents.includes(parentId)) {
    throw driveFailure('DRIVE_ARCHIVE_FOLDER_CREATE_INVALID', 'Google Drive tidak mengembalikan folder arsip yang valid; file bukti tidak dipindahkan.', 502);
  }
  return created.id;
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Gunakan POST.', 405);

    const oauth = getGoogleOAuthConfig();
    const missing = [
      ...(!getWebhookSecret() ? ['STOCKTRACE_SHEETS_WEBHOOK_SECRET'] : []),
      ...(!oauth.clientId ? ['GOOGLE_CLIENT_ID'] : []),
      ...(!oauth.clientSecret ? ['GOOGLE_CLIENT_SECRET'] : []),
      ...(!oauth.refreshToken ? ['GOOGLE_REFRESH_TOKEN'] : [])
    ];
    try { getDriveFolderId('r1'); getDriveFolderId('intake'); }
    catch (error) { missing.push(error.code || 'STOCKTRACE_INTEGRATION_TARGETS_JSON'); }
    if (missing.length) return fail('CONFIG_MISSING', `Konfigurasi integrasi belum lengkap: ${[...new Set(missing)].join(', ')}.`, 503);

    const length = Number(request.headers.get('content-length') || 0);
    if (length > MAX_BODY_BYTES) return fail('BODY_TOO_LARGE', 'Payload webhook terlalu besar.', 413);
    if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      return fail('INVALID_CONTENT_TYPE', 'Webhook harus mengirim application/json.', 415);
    }

    if (!secretMatches(
      request.headers.get('x-stocktrace-sync-secret') || '',
      getWebhookSecret()
    )) return fail('UNAUTHORIZED', 'Webhook tidak terautentikasi.', 401);

    try {
      let body;
      try { body = await request.json(); }
      catch { return fail('BAD_JSON', 'Payload webhook bukan JSON valid.', 400); }

      if (body?.schema !== 'public' || !['DELETE', 'UPDATE'].includes(body?.type) || !TABLES[body?.table]) {
        return fail('EVENT_NOT_SUPPORTED', 'Hanya event DELETE atau perubahan status arsip pada tabel bukti StockTrace yang diterima.', 400);
      }

      const config = TABLES[body.table];
      let action = 'delete';
      let record = body.old_record;

      if (body.type === 'UPDATE') {
        const oldRecord = body.old_record;
        const newRecord = body.record;
        if (!oldRecord || typeof oldRecord !== 'object' || !newRecord || typeof newRecord !== 'object') {
          return fail('UPDATE_RECORD_MISSING', 'Payload UPDATE harus memuat record dan old_record.', 400);
        }
        const wasArchived = Boolean(oldRecord.deleted_at);
        const isArchived = Boolean(newRecord.deleted_at);
        // A repeated UPDATE where both values are archived is also used by SQL 13
        // to reconcile evidence that was archived before Drive folder moves existed.
        if (!wasArchived && !isArchived) {
          return json({ ok: true, kind: 'drive_archive', table: body.table, action: 'no_status_change' });
        }
        action = isArchived ? 'archive' : 'restore';
        record = newRecord;
      }

      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return fail('OLD_RECORD_MISSING', 'Payload webhook tidak memuat record yang valid.', 400);
      }

      const recordId = String(record[config.idField] || '').trim();
      if (!config.idPattern.test(recordId)) return fail('RECORD_ID_INVALID', 'ID kasus/penerimaan pada record tidak valid.', 400);

      const fileId = String(record.drive_file_id || '').trim();
      if (!fileId) return json({ ok: true, kind: action === 'delete' ? 'drive_delete' : 'drive_archive', table: body.table, action: 'no_drive_file_id' });
      if (!FILE_ID_PATTERN.test(fileId)) return fail('FILE_ID_INVALID', 'ID file Google Drive tidak valid.', 400);

      const rootFolderId = folderFor(config);
      const token = await googleAccessToken();
      const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
      metadataUrl.searchParams.set('fields', 'id,name,description,parents,trashed,appProperties,mimeType');
      metadataUrl.searchParams.set('supportsAllDrives', 'true');
      const metadataResponse = await driveRequest(metadataUrl.toString(), token);

      if (metadataResponse.status === 404 || metadataResponse.status === 410) {
        return json({ ok: true, kind: action === 'delete' ? 'drive_delete' : 'drive_archive', table: body.table, action: 'already_missing' });
      }
      const metadata = await readDriveJson(metadataResponse, 'DRIVE_METADATA_FAILED', 'Pemeriksaan metadata file');

      if (metadata.trashed && action !== 'restore') {
        return json({ ok: true, kind: action === 'delete' ? 'drive_delete' : 'drive_archive', table: body.table, action: 'already_trashed' });
      }

      const props = metadata.appProperties || {};
      const expectedProperty = props[config.appProperty];
      const expectedPrefix = `${recordId}__`;
      const validStockTraceName = String(metadata.name || '').startsWith(expectedPrefix);
      const validDescription = String(metadata.description || '').includes('StockTrace');
      const validProperty = expectedProperty === undefined || expectedProperty === recordId;
      const storedOriginalParent = String(props.stocktrace_original_parent || '');
      const storedArchiveFolder = String(props.stocktrace_archive_folder || '');
      const parents = Array.isArray(metadata.parents) ? metadata.parents : [];
      const validRootParent = parents.includes(rootFolderId);
      const validStoredArchiveParent = storedOriginalParent === rootFolderId &&
        FILE_ID_PATTERN.test(storedArchiveFolder) && parents.includes(storedArchiveFolder);
      const restoreFromTrash = action === 'restore' && metadata.trashed === true;
      const restoreCanUseStoredParent = action === 'restore' && restoreFromTrash && storedOriginalParent === rootFolderId;

      if (!validStockTraceName || !validDescription || !validProperty) {
        console.error('StockTrace Drive operation refused: ownership metadata mismatch', {
          table: body.table, fileId, recordId, action,
          nameMatches: validStockTraceName,
          descriptionMatches: validDescription,
          appPropertyMatches: validProperty
        });
        return fail('DRIVE_FILE_NOT_OWNED', 'File tidak cocok dengan metadata StockTrace; tindakan dibatalkan.', 403);
      }

      if (action === 'delete') {
        if (!validRootParent && !validStoredArchiveParent) {
          return fail('DRIVE_FILE_NOT_OWNED', 'File tidak berada di folder aktif atau folder arsip StockTrace; tindakan dibatalkan.', 403);
        }
        const deleteUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
        deleteUrl.searchParams.set('supportsAllDrives', 'true');
        deleteUrl.searchParams.set('fields', 'id,trashed,parents');
        const response = await driveRequest(deleteUrl.toString(), token, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trashed: true })
        });
        const result = await readDriveJson(response, 'DRIVE_TRASH_FAILED', 'Pemindahan file ke Bin');
        if (result.trashed !== true) {
          throw driveFailure('DRIVE_TRASH_FAILED', 'Google Drive tidak mengonfirmasi pemindahan file ke Bin.', 502);
        }
        return json({ ok: true, kind: 'drive_delete', table: body.table, action: 'moved_to_trash' });
      }

      const updateUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
      updateUrl.searchParams.set('supportsAllDrives', 'true');
      updateUrl.searchParams.set('fields', 'id,trashed,appProperties,parents');

      let nextProperties = { ...props };
      let patchBody;
      let movedFolder = false;

      if (action === 'archive') {
        let archiveFolderId = '';
        if (validStoredArchiveParent) {
          archiveFolderId = storedArchiveFolder;
        } else if (validRootParent) {
          archiveFolderId = await findOrCreateArchiveFolder(rootFolderId, token, config.archiveKind);
        } else {
          return fail('DRIVE_FILE_NOT_OWNED', 'File tidak berada di folder bukti aktif atau folder arsip StockTrace; tindakan dibatalkan.', 403);
        }

        if (parents.includes(archiveFolderId)) {
          nextProperties.stocktrace_status = 'archived';
          patchBody = { appProperties: nextProperties };
        } else {
          updateUrl.searchParams.set('addParents', archiveFolderId);
          updateUrl.searchParams.set('removeParents', rootFolderId);
          nextProperties.stocktrace_status = 'archived';
          nextProperties.stocktrace_original_parent = rootFolderId;
          nextProperties.stocktrace_archive_folder = archiveFolderId;
          patchBody = { appProperties: nextProperties };
          movedFolder = true;
        }
      } else {
        // New archives are moved back from the managed subfolder. Older V2.2 archives
        // that were only marked in appProperties remain in the root and are activated there.
        const canRestoreFromArchive = validStoredArchiveParent;
        if (!validRootParent && !canRestoreFromArchive && !restoreCanUseStoredParent) {
          return fail('DRIVE_FILE_NOT_OWNED', 'File tidak berada di folder aktif atau folder arsip StockTrace; pemulihan dibatalkan.', 403);
        }
        if (canRestoreFromArchive) {
          updateUrl.searchParams.set('addParents', rootFolderId);
          updateUrl.searchParams.set('removeParents', storedArchiveFolder);
          movedFolder = true;
        } else if (restoreFromTrash && !validRootParent) {
          updateUrl.searchParams.set('addParents', rootFolderId);
        }
        nextProperties.stocktrace_status = 'active';
        patchBody = {
          ...(restoreFromTrash ? { trashed: false } : {}),
          appProperties: nextProperties
        };
      }

      const response = await driveRequest(updateUrl.toString(), token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody)
      });
      const result = await readDriveJson(response, 'DRIVE_ARCHIVE_UPDATE_FAILED', 'Pemindahan status/folder arsip');
      const resultingParents = Array.isArray(result.parents) ? result.parents : null;
      if (action === 'archive' && movedFolder && resultingParents && !resultingParents.includes(String(patchBody.appProperties.stocktrace_archive_folder))) {
        throw driveFailure('DRIVE_ARCHIVE_MOVE_UNCONFIRMED', 'Google Drive belum mengonfirmasi bahwa file masuk ke folder arsip.', 502);
      }
      if (action === 'restore' && (result.trashed === true || (movedFolder && resultingParents && !resultingParents.includes(rootFolderId)))) {
        throw driveFailure('DRIVE_ARCHIVE_RESTORE_UNCONFIRMED', 'Google Drive belum mengonfirmasi bahwa file kembali ke folder aktif.', 502);
      }

      return json({
        ok: true,
        kind: 'drive_archive',
        table: body.table,
        action: action === 'archive'
          ? (movedFolder ? 'moved_to_archive_folder' : 'already_in_archive_folder')
          : (movedFolder ? 'restored_to_active_folder' : 'restored_active')
      });
    } catch (error) {
      const status = Number(error.status) || 502;
      console.error('StockTrace Drive archive/delete operation failed:', error.code || 'UNEXPECTED', error.message);
      return fail(error.code || 'DRIVE_DELETE_FAILED',
        status === 500 ? 'Server gagal memproses penghapusan Drive. Periksa Vercel Logs.' : error.message,
        status);
    }
  }
};
