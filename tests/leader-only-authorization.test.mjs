import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('PIC migration replaces database leader helper with a strict Leader-only check',()=>{
 const sql=read('sql/03_AKTIFKAN_PIC_V1_2_JALANKAN_SEKALI.sql');
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.stocktrace_is_leader\(\)/);
 assert.match(sql,/lower\(btrim\(u\.role\)\)\s*=\s*'leader'/);
 assert.doesNotMatch(sql,/Hanya Leader\/Admin/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.stocktrace_assign_pic\(/);
});

test('fresh installs and later RPC migration retain shared Leader-only guard',()=>{
 const source=read('sql/01_MIGRASI_FINAL_SESUAI_DATABASE.sql');
 const future=read('sql/09_RPC_GUARD_FORCED_PASSWORD.sql');
 const v21=read('sql/10_V2_1_PENERIMAAN_DAN_MONITORING_KASIR_STAGING.sql');
 assert.match(source,/lower\(btrim\(u\.role\)\)\s*=\s*'leader'/);
 assert.match(future,/NOT public\.stocktrace_is_leader\(\)/);
 assert.match(v21,/NOT public\.stocktrace_is_leader\(\)/);
});

test('UI and manual Sheets API reject Admin as operator',()=>{
 const app=read('app.js'); const sheets=read('api/sheets-sync.mjs');
 assert.match(app,/function canManageCases\(\)\{return activeRole\.toLowerCase\(\)\.trim\(\)===?=?'leader'/);
 assert.match(sheets,/FULL_SYNC_LEADER_ROLES=new Set\(\['leader'\]\)/);
});

test('SQL02 preserves read-all policy including Admin',()=>{
 const s=read('sql/02_IZIN_BACA_SEMUA_LAPORAN_STAFF_LEADER.sql');
 assert.match(s,/ALTER POLICY st_cases_read/);
 assert.match(s,/IN \('staff','leader','admin','store leader','store_leader'\)/);
});
