import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sql = read('sql/12_SOFT_DELETE_ARCHIVE_FINAL.sql');
const app = read('app.js');
const v21 = read('v21.js');
const login = read('login.html');
const sheets = read('api/sheets-sync.mjs');
const drive = read('api/drive-delete.mjs');
const html = read('index.html');
const css = read('stocktrace-professional-rose.css');

test('soft-delete migration is additive and never grants or runs hard deletion', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS deleted_at/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.stocktrace_archive_events/);
  assert.match(sql, /stocktrace_archive_record/);
  assert.match(sql, /stocktrace_restore_record/);
  assert.match(sql, /REVOKE INSERT ON public\.evidence_files/);
  assert.match(sql, /GRANT INSERT \(id_kasus,nama_file_asli,drive_file_id,drive_view_url,uploaded_by\)/);
  const executableSql = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(executableSql, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b|\bGRANT\s+DELETE\b/i);
});

test('archive RPC is protected and role-limited; restore is Leader-only', () => {
  assert.match(sql, /public\.stocktrace_can_use_app\(\)/);
  assert.match(sql, /public\.stocktrace_is_leader\(\)/);
  assert.match(sql, /Staff hanya dapat mengarsipkan laporan miliknya/);
  assert.match(sql, /Hanya Leader aktif yang dapat memulihkan data/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.stocktrace_archive_record/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.stocktrace_restore_record/);
});

test('soft archive preserves Drive files and sends reversible status updates', () => {
  assert.match(drive, /body\.type === 'UPDATE'/);
  assert.match(drive, /stocktrace_status: action === 'archive' \? 'archived' : 'active'/);
  assert.match(drive, /trashed: false/);
  assert.match(sql, /AFTER UPDATE OF deleted_at/);
  assert.match(sql, /stocktrace_soft_archive_drive_evidence/);
});

test('Google Sheets marks archived records and appends the status header safely', () => {
  assert.match(sheets, /status_data/);
  assert.match(sheets, /DIARSIPKAN/);
  assert.match(sheets, /lastExisting<expected\.length/);
  assert.match(sheets, /expected\.slice\(lastExisting\)/);
});

test('archive and restore controls are wired for case, evidence, intake, and cashier', () => {
  for (const type of ['case','evidence','intake','intake_evidence','cashier_request']) {
    assert.ok(app.includes(`'${type}'`) || v21.includes(`'${type}'`), `missing ${type}`);
  }
  assert.match(html, /Arsip & Sampah/);
  assert.match(html, /btnArchiveCase/);
  assert.match(app, /stocktrace_archive_record/);
  assert.match(app, /stocktrace_restore_record/);
  assert.match(v21, /data-archive-intake/);
  assert.match(v21, /data-archive-cashier/);
});

test('Supabase auth uses per-tab sessionStorage on login and dashboard', () => {
  assert.match(login, /storage:window\.sessionStorage/);
  assert.match(app, /storage:window\.sessionStorage/);
  assert.match(login, /sessionStorage\.setItem\('user_role'/);
  assert.match(app, /sessionStorage\.removeItem\('user_role'/);
  assert.doesNotMatch(login, /localStorage\.setItem\('user_role'/);
});

test('responsive design preserves mobile drawer and adapts archive tables/actions', () => {
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /\.st-archive-action/);
  assert.match(css, /#view-archive \.st-data-table table/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});
