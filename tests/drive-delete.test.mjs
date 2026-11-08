import test from 'node:test';
import assert from 'node:assert/strict';
import driveDelete from '../api/drive-delete.mjs';

const caseId = 'ST-261108-2fd18cf044ca';
const intakeId = 'IN-20261108-ABCDEF123456';
const fileId = '1A2b3C4d5E6f7G8h9I0j';
const secret = 'test-webhook-secret-long-enough';
const envNames = [
  'STOCKTRACE_SHEETS_WEBHOOK_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN','GOOGLE_DRIVE_FOLDER_ID','GOOGLE_DRIVE_INTAKE_FOLDER_ID'
];
const saved = Object.fromEntries(envNames.map(k => [k, process.env[k]]));
Object.assign(process.env, {
  STOCKTRACE_SHEETS_WEBHOOK_SECRET: secret,
  GOOGLE_CLIENT_ID: 'client-test',
  GOOGLE_CLIENT_SECRET: 'secret-test',
  GOOGLE_REFRESH_TOKEN: 'refresh-test',
  GOOGLE_DRIVE_FOLDER_ID: 'case-folder-123456',
  GOOGLE_DRIVE_INTAKE_FOLDER_ID: 'intake-folder-123456'
});
const originalFetch = globalThis.fetch;
const request = (table, oldRecord, headers = {}) => new Request('https://staging.example/api/drive-delete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-stocktrace-sync-secret': secret, ...headers },
  body: JSON.stringify({ schema: 'public', type: 'DELETE', table, old_record: oldRecord })
});
function mockDrive({ metadata, patchStatus = 200, metadataStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'google-token' });
    if (u.includes('/drive/v3/files/')) {
      if ((init.method || 'GET') === 'PATCH') return Response.json({ id: fileId, trashed: true }, { status: patchStatus });
      if (metadataStatus !== 200) return Response.json({ error: { message: 'not found' } }, { status: metadataStatus });
      return Response.json(metadata);
    }
    throw new Error('Unexpected request: ' + u);
  };
  return calls;
}
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
  const calls = mockDrive({ metadata: {
    id: fileId, name: `${caseId}__photo.jpg`, description: `StockTrace — bukti kasus ${caseId}`,
    parents: ['case-folder-123456'], trashed: false,
    appProperties: { stocktrace_case: caseId }
  } });
  const r = await driveDelete.fetch(request('evidence_files', { id_kasus: caseId, drive_file_id: fileId }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'moved_to_trash');
  assert.equal(calls.filter(x => x.init.method === 'PATCH').length, 1);
  assert.deepEqual(JSON.parse(calls.find(x => x.init.method === 'PATCH').init.body), { trashed: true });
});

test('moves a verified intake evidence file to Trash in the intake folder', async () => {
  mockDrive({ metadata: {
    id: fileId, name: `${intakeId}__receipt.pdf`, description: `StockTrace — bukti penerimaan ${intakeId}`,
    parents: ['intake-folder-123456'], trashed: false,
    appProperties: { stocktrace_intake: intakeId }
  } });
  const r = await driveDelete.fetch(request('stocktrace_intake_evidence', { id_intake: intakeId, drive_file_id: fileId }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'moved_to_trash');
});

test('refuses a file outside the expected folder', async () => {
  mockDrive({ metadata: {
    id: fileId, name: `${caseId}__photo.jpg`, description: `StockTrace — bukti kasus ${caseId}`,
    parents: ['other-folder'], trashed: false, appProperties: { stocktrace_case: caseId }
  } });
  const r = await driveDelete.fetch(request('evidence_files', { id_kasus: caseId, drive_file_id: fileId }));
  assert.equal(r.status, 403);
});

test('treats an already missing file as idempotent success', async () => {
  mockDrive({ metadataStatus: 404 });
  const r = await driveDelete.fetch(request('evidence_files', { id_kasus: caseId, drive_file_id: fileId }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).action, 'already_missing');
});
