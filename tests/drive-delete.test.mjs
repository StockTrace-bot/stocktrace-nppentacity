import test from 'node:test';
import assert from 'node:assert/strict';
import driveDelete from '../api/drive-delete.mjs';

const caseId = 'ST-261108-2fd18cf044ca';
const intakeId = 'IN-20261108-ABCDEF123456';
const fileId = '1A2b3C4d5E6f7G8h9I0j';
const rootFolderId = 'case-folder-123456';
const intakeFolderId = 'intake-folder-123456';
const archiveFolderId = 'archive-folder-123456';
const secret = 'test-webhook-secret-long-enough';
const envNames = [
  'STOCKTRACE_INTEGRATION_TARGETS_JSON', 'STOCKTRACE_SHEETS_WEBHOOK_SECRET',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_FOLDER_ID', 'GOOGLE_DRIVE_INTAKE_FOLDER_ID'
];
const saved = Object.fromEntries(envNames.map(k => [k, process.env[k]]));
delete process.env.STOCKTRACE_INTEGRATION_TARGETS_JSON;
Object.assign(process.env, {
  STOCKTRACE_SHEETS_WEBHOOK_SECRET: secret,
  GOOGLE_CLIENT_ID: 'client-test',
  GOOGLE_CLIENT_SECRET: 'secret-test',
  GOOGLE_REFRESH_TOKEN: 'refresh-test',
  GOOGLE_DRIVE_FOLDER_ID: rootFolderId,
  GOOGLE_DRIVE_INTAKE_FOLDER_ID: intakeFolderId
});
const originalFetch = globalThis.fetch;
const request = (table, oldRecord, headers = {}) => new Request('https://staging.example/api/drive-delete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-stocktrace-sync-secret': secret, ...headers },
  body: JSON.stringify({ schema: 'public', type: 'DELETE', table, old_record: oldRecord })
});
const archiveRequest = (table, oldRecord, record) => new Request('https://staging.example/api/drive-delete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-stocktrace-sync-secret': secret },
  body: JSON.stringify({ schema: 'public', type: 'UPDATE', table, old_record: oldRecord, record })
});
function mockDrive({
  metadata,
  metadataStatus = 200,
  archiveFolders = [],
  createdFolder = {
    id: archiveFolderId,
    name: 'ARSIP STOCKTRACE',
    mimeType: 'application/vnd.google-apps.folder',
    parents: [rootFolderId],
    appProperties: {
      stocktrace_archive_folder: 'true',
      stocktrace_archive_parent: rootFolderId,
      stocktrace_archive_kind: 'case_evidence'
    }
  },
  createStatus = 200,
  patchStatus = 200,
  patchResult
} = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ url: u.toString(), init });
    if (u.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'google-token' });
    if (u.pathname === '/drive/v3/files' && (init.method || 'GET') === 'GET') {
      return Response.json({ files: archiveFolders });
    }
    if (u.pathname === '/drive/v3/files' && init.method === 'POST') {
      return Response.json(createdFolder, { status: createStatus });
    }
    if (u.pathname === `/drive/v3/files/${fileId}`) {
      if (init.method === 'PATCH') {
        return Response.json(patchResult || { id: fileId, trashed: true, parents: metadata?.parents || [] }, { status: patchStatus });
      }
      if (metadataStatus !== 200) return Response.json({ error: { message: 'not found' } }, { status: metadataStatus });
      return Response.json(metadata);
    }
    throw new Error('Unexpected request: ' + u.toString());
  };
  return calls;
}
const stocktraceCaseMetadata = (overrides = {}) => ({
  id: fileId,
  name: `${caseId}__photo.jpg`,
  description: `StockTrace — bukti kasus ${caseId}`,
  parents: [rootFolderId],
  trashed: false,
  appProperties: { stocktrace_case: caseId, stocktrace_status: 'active' },
  ...overrides
});

test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('rejects a request without the webhook secret', async () => {
  const r = await driveDelete.fetch(request('evidence_files', { id_kasus: caseId, drive_file_id: fileId }, { 'x-stocktrace-sync-secret': 'wrong' }));
  assert.equal(r.status, 401);
});

test('rejects unsupported table and event', async () => {
  const r = await driveDelete.fetch(new Request('https://staging.example/api/drive-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-stocktrace-sync-secret': secret },
    body: JSON.stringify({ schema: 'public', type: 'UPDATE', table: 'cases', record: {} })
  }));
  assert.equal(r.status, 400);
});

test('moves a verified R1 evidence file to Trash', async () => {
  const calls = mockDrive({ metadata: stocktraceCaseMetadata() });
  const r = await driveDelete.fetch(request('evidence_files', { id_kasus: caseId, drive_file_id: fileId }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'moved_to_trash');
  const patch = calls.find(x => x.init.method === 'PATCH');
  assert.ok(patch);
  assert.deepEqual(JSON.parse(patch.init.body), { trashed: true });
});

test('moves a verified intake evidence file to Trash in the intake folder', async () => {
  mockDrive({ metadata: {
    id: fileId, name: `${intakeId}__receipt.pdf`, description: `StockTrace — bukti penerimaan ${intakeId}`,
    parents: [intakeFolderId], trashed: false,
    appProperties: { stocktrace_intake: intakeId }
  } });
  const r = await driveDelete.fetch(request('stocktrace_intake_evidence', { id_intake: intakeId, drive_file_id: fileId }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'moved_to_trash');
});

test('refuses a file outside the expected folder', async () => {
  mockDrive({ metadata: stocktraceCaseMetadata({ parents: ['other-folder'] }) });
  const r = await driveDelete.fetch(request('evidence_files', { id_kasus: caseId, drive_file_id: fileId }));
  assert.equal(r.status, 403);
});

test('treats an already missing file as idempotent success', async () => {
  mockDrive({ metadataStatus: 404 });
  const r = await driveDelete.fetch(request('evidence_files', { id_kasus: caseId, drive_file_id: fileId }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'already_missing');
});

test('archive creates a managed subfolder and moves the evidence out of the active folder', async () => {
  const calls = mockDrive({
    metadata: stocktraceCaseMetadata(),
    patchResult: {
      id: fileId, trashed: false, parents: [archiveFolderId],
      appProperties: {
        stocktrace_case: caseId,
        stocktrace_status: 'archived',
        stocktrace_original_parent: rootFolderId,
        stocktrace_archive_folder: archiveFolderId
      }
    }
  });
  const r = await driveDelete.fetch(archiveRequest('evidence_files',
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: null },
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: '2026-11-11T00:00:00Z' }
  ));
  const payload = await r.json();
  assert.equal(r.status, 200, JSON.stringify(payload));
  assert.equal(payload.action, 'moved_to_archive_folder');
  const create = calls.find(x => x.init.method === 'POST' && x.url.includes('/drive/v3/files?'));
  assert.ok(create, 'archive folder should be created on first archive');
  assert.deepEqual(JSON.parse(create.init.body).parents, [rootFolderId]);
  const patch = calls.find(x => x.init.method === 'PATCH');
  const patchUrl = new URL(patch.url);
  assert.equal(patchUrl.searchParams.get('addParents'), archiveFolderId);
  assert.equal(patchUrl.searchParams.get('removeParents'), rootFolderId);
  const patchBody = JSON.parse(patch.init.body);
  assert.equal(patchBody.appProperties.stocktrace_status, 'archived');
  assert.equal(patchBody.appProperties.stocktrace_original_parent, rootFolderId);
  assert.equal(patchBody.appProperties.stocktrace_archive_folder, archiveFolderId);
});

test('intake evidence uses a separate archive subfolder under the intake root', async () => {
  const calls = mockDrive({
    metadata: {
      id: fileId,
      name: `${intakeId}__receipt.pdf`,
      description: `StockTrace — bukti penerimaan ${intakeId}`,
      parents: [intakeFolderId],
      trashed: false,
      appProperties: { stocktrace_intake: intakeId, stocktrace_status: 'active' }
    },
    createdFolder: {
      id: archiveFolderId,
      name: 'ARSIP STOCKTRACE',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [intakeFolderId],
      appProperties: {
        stocktrace_archive_folder: 'true',
        stocktrace_archive_parent: intakeFolderId,
        stocktrace_archive_kind: 'intake_evidence'
      }
    },
    patchResult: {
      id: fileId, trashed: false, parents: [archiveFolderId],
      appProperties: {
        stocktrace_intake: intakeId,
        stocktrace_status: 'archived',
        stocktrace_original_parent: intakeFolderId,
        stocktrace_archive_folder: archiveFolderId
      }
    }
  });
  const r = await driveDelete.fetch(archiveRequest('stocktrace_intake_evidence',
    { id_intake: intakeId, drive_file_id: fileId, deleted_at: null },
    { id_intake: intakeId, drive_file_id: fileId, deleted_at: '2026-11-11T00:00:00Z' }
  ));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'moved_to_archive_folder');
  const create = calls.find(x => x.init.method === 'POST' && x.url.includes('/drive/v3/files?'));
  assert.deepEqual(JSON.parse(create.init.body).parents, [intakeFolderId]);
  assert.equal(JSON.parse(create.init.body).appProperties.stocktrace_archive_kind, 'intake_evidence');
  const patch = calls.find(x => x.init.method === 'PATCH');
  assert.equal(new URL(patch.url).searchParams.get('removeParents'), intakeFolderId);
});

test('archive is idempotent when the file is already in its managed archive folder', async () => {
  const calls = mockDrive({
    metadata: stocktraceCaseMetadata({
      parents: [archiveFolderId],
      appProperties: {
        stocktrace_case: caseId, stocktrace_status: 'archived',
        stocktrace_original_parent: rootFolderId, stocktrace_archive_folder: archiveFolderId
      }
    }),
    patchResult: {
      id: fileId, trashed: false, parents: [archiveFolderId],
      appProperties: { stocktrace_case: caseId, stocktrace_status: 'archived' }
    }
  });
  const r = await driveDelete.fetch(archiveRequest('evidence_files',
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: '2026-11-11T00:00:00Z' },
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: '2026-11-11T00:00:00Z' }
  ));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'already_in_archive_folder');
  assert.equal(calls.filter(x => x.init.method === 'POST' && x.url.includes('/drive/v3/files?')).length, 0);
  const patch = calls.find(x => x.init.method === 'PATCH');
  assert.ok(patch);
  assert.equal(new URL(patch.url).searchParams.has('addParents'), false);
});

test('restore moves an archived evidence file back to its original active folder', async () => {
  const calls = mockDrive({
    metadata: stocktraceCaseMetadata({
      parents: [archiveFolderId],
      appProperties: {
        stocktrace_case: caseId, stocktrace_status: 'archived',
        stocktrace_original_parent: rootFolderId, stocktrace_archive_folder: archiveFolderId
      }
    }),
    patchResult: {
      id: fileId, trashed: false, parents: [rootFolderId],
      appProperties: {
        stocktrace_case: caseId, stocktrace_status: 'active',
        stocktrace_original_parent: rootFolderId, stocktrace_archive_folder: archiveFolderId
      }
    }
  });
  const r = await driveDelete.fetch(archiveRequest('evidence_files',
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: '2026-11-11T00:00:00Z' },
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: null }
  ));
  const payload = await r.json();
  assert.equal(r.status, 200, JSON.stringify(payload));
  assert.equal(payload.action, 'restored_to_active_folder');
  const patch = calls.find(x => x.init.method === 'PATCH');
  const patchUrl = new URL(patch.url);
  assert.equal(patchUrl.searchParams.get('addParents'), rootFolderId);
  assert.equal(patchUrl.searchParams.get('removeParents'), archiveFolderId);
  assert.equal(JSON.parse(patch.init.body).appProperties.stocktrace_status, 'active');
});

test('legacy V2.2 archives still restore when the file remained in the active folder', async () => {
  const calls = mockDrive({
    metadata: stocktraceCaseMetadata({ appProperties: { stocktrace_case: caseId, stocktrace_status: 'archived' } }),
    patchResult: { id: fileId, trashed: false, parents: [rootFolderId], appProperties: { stocktrace_case: caseId, stocktrace_status: 'active' } }
  });
  const r = await driveDelete.fetch(archiveRequest('evidence_files',
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: '2026-11-11T00:00:00Z' },
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: null }
  ));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'restored_active');
  const patch = calls.find(x => x.init.method === 'PATCH');
  assert.equal(new URL(patch.url).searchParams.has('addParents'), false);
  assert.deepEqual(JSON.parse(patch.init.body), {
    appProperties: { stocktrace_case: caseId, stocktrace_status: 'active' }
  });
});

test('refuses to adopt an unmarked folder with the archive folder name', async () => {
  mockDrive({
    metadata: stocktraceCaseMetadata(),
    archiveFolders: [{
      id: archiveFolderId, name: 'ARSIP STOCKTRACE',
      mimeType: 'application/vnd.google-apps.folder', parents: [rootFolderId], appProperties: {}
    }]
  });
  const r = await driveDelete.fetch(archiveRequest('evidence_files',
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: null },
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: '2026-11-11T00:00:00Z' }
  ));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'DRIVE_ARCHIVE_FOLDER_CONFLICT');
});

test('a repeated archived UPDATE reconciles an old file still in the root folder', async () => {
  const calls = mockDrive({
    metadata: stocktraceCaseMetadata({ appProperties: { stocktrace_case: caseId, stocktrace_status: 'archived' } }),
    patchResult: {
      id: fileId, trashed: false, parents: [archiveFolderId],
      appProperties: {
        stocktrace_case: caseId, stocktrace_status: 'archived',
        stocktrace_original_parent: rootFolderId, stocktrace_archive_folder: archiveFolderId
      }
    }
  });
  const r = await driveDelete.fetch(archiveRequest('evidence_files',
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: '2026-11-10T00:00:00Z' },
    { id_kasus: caseId, drive_file_id: fileId, deleted_at: '2026-11-10T00:00:00Z' }
  ));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'moved_to_archive_folder');
  const patch = calls.find(x => x.init.method === 'PATCH');
  assert.equal(new URL(patch.url).searchParams.get('removeParents'), rootFolderId);
});
