import test from 'node:test';
import assert from 'node:assert/strict';
import { getDriveFolderId, getSheetsSpreadsheetId, getUnifiedSheetsId, getIntegrationTargets, integrationHealth } from '../api/_lib/stocktrace-config.mjs';

const names = [
  'STOCKTRACE_INTEGRATION_TARGETS_JSON','STOCKTRACE_OPERATIONS_SPREADSHEET_ID',
  'GOOGLE_DRIVE_FOLDER_ID', 'GOOGLE_DRIVE_INTAKE_FOLDER_ID',
  'GOOGLE_SHEETS_SPREADSHEET_ID', 'GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID',
  'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON', 'STOCKTRACE_SHEETS_WEBHOOK_SECRET', 'VERCEL_ENV'
];
const saved = Object.fromEntries(names.map(k => [k, process.env[k]]));
function restore() { for (const k of names) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
function setCredentials() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://main-project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh',
    GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON: JSON.stringify({type:'service_account',private_key:'test-key',client_email:'test@example.test'}),
    STOCKTRACE_SHEETS_WEBHOOK_SECRET: 'webhook-secret'
  });
}
test.afterEach(restore);

test('single JSON target map overrides all legacy target variables', () => {
  Object.assign(process.env, {
    GOOGLE_DRIVE_FOLDER_ID: 'old-case-folder', GOOGLE_DRIVE_INTAKE_FOLDER_ID: 'old-intake-folder',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'old-r1-sheet-id', GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID: 'old-intake-sheet'
  });
  process.env.STOCKTRACE_INTEGRATION_TARGETS_JSON = JSON.stringify({
    drive: {r1FolderId:'new-case-folder-id',intakeFolderId:'new-intake-folder-id'},
    sheets: {r1SpreadsheetId:'new-r1-spreadsheet-id',intakeSpreadsheetId:'new-intake-spreadsheet'}
  });
  assert.equal(getDriveFolderId('r1'),'new-case-folder-id');
  assert.equal(getDriveFolderId('intake'),'new-intake-folder-id');
  assert.equal(getSheetsSpreadsheetId('r1'),'new-r1-spreadsheet-id');
  assert.equal(getSheetsSpreadsheetId('intake'),'new-intake-spreadsheet');
  assert.equal(getIntegrationTargets().source,'STOCKTRACE_INTEGRATION_TARGETS_JSON');
});

test('legacy environment values remain supported when the JSON map is absent', () => {
  delete process.env.STOCKTRACE_INTEGRATION_TARGETS_JSON;
  Object.assign(process.env, {
    GOOGLE_DRIVE_FOLDER_ID:'legacy-case-folder-id', GOOGLE_DRIVE_INTAKE_FOLDER_ID:'legacy-intake-folder-id',
    GOOGLE_SHEETS_SPREADSHEET_ID:'legacy-r1-spreadsheet', GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID:'legacy-intake-spreadsheet'
  });
  assert.equal(getDriveFolderId('r1'),'legacy-case-folder-id');
  assert.equal(getSheetsSpreadsheetId('intake'),'legacy-intake-spreadsheet');
  assert.equal(getIntegrationTargets().source,'legacy_environment_variables');
});

test('one JSON map with missing or duplicate destinations fails closed', () => {
  process.env.STOCKTRACE_INTEGRATION_TARGETS_JSON = JSON.stringify({drive:{r1FolderId:'only-case-folder'},sheets:{r1SpreadsheetId:'only-r1-sheet'}});
  assert.throws(() => getDriveFolderId('intake'), {code:'INTEGRATION_TARGET_MISSING'});
  process.env.STOCKTRACE_INTEGRATION_TARGETS_JSON = JSON.stringify({
    drive:{r1FolderId:'same-folder-id',intakeFolderId:'same-folder-id'},
    sheets:{r1SpreadsheetId:'r1-spreadsheet-id',intakeSpreadsheetId:'intake-spreadsheet-id'}
  });
  assert.throws(() => getIntegrationTargets(), {code:'DRIVE_FOLDER_COLLISION'});
});

test('health endpoint data is redacted and identifies its configuration source', () => {
  setCredentials();
  process.env.STOCKTRACE_INTEGRATION_TARGETS_JSON = JSON.stringify({
    drive:{r1FolderId:'case-folder-12345',intakeFolderId:'intake-folder-12345'},
    sheets:{r1SpreadsheetId:'r1-spreadsheet-12345',intakeSpreadsheetId:'intake-spreadsheet-12345'}
  });
  process.env.VERCEL_ENV='production';
  const report=integrationHealth();
  assert.equal(report.environment,'production');
  assert.equal(report.targetConfigSource,'STOCKTRACE_INTEGRATION_TARGETS_JSON');
  assert.equal(report.supabaseProjectRef,'main-project');
  assert.equal(report.ok,true);
  assert.equal(JSON.stringify(report).includes('case-folder-12345'),false);
});

test('unified workbook overrides all three sheet destinations without touching Drive',()=>{
 setCredentials();process.env.STOCKTRACE_INTEGRATION_TARGETS_JSON=JSON.stringify({drive:{r1FolderId:'case-folder-12345',intakeFolderId:'intake-folder-12345'},sheets:{}});
 process.env.STOCKTRACE_OPERATIONS_SPREADSHEET_ID='operations-workbook-12345';
 for(const k of ['r1','intake','sales'])assert.equal(getSheetsSpreadsheetId(k),'operations-workbook-12345');
 assert.equal(getDriveFolderId('r1'),'case-folder-12345');assert.equal(getIntegrationTargets().sheets.intakeSpreadsheetId,'operations-workbook-12345');
 const health=integrationHealth();assert.equal(health.ok,true);assert.equal(health.sheetsMode,'unified');assert.equal(health.fingerprints.sheetsR1,health.fingerprints.sheetsIntake);
 process.env.STOCKTRACE_OPERATIONS_SPREADSHEET_ID='https://invalid';assert.throws(()=>getUnifiedSheetsId(),{code:'INTEGRATION_TARGET_MISSING'});assert.equal(integrationHealth().ok,false);
});

test('actual Sheets webhook and full-sync router retains all 14 distinct managed tabs on unified destination', async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm');
 const code=fs.readFileSync('api/sheets-sync.mjs','utf8');
 const model=code.slice(code.indexOf('const SHEETS = {'),code.indexOf('const FULL_SYNC_LEADER_ROLES'));
 const fn=code.slice(code.indexOf('function getSpreadsheetId(target)'),code.indexOf('// Keep all webhook-written'));
 const ctx=vm.createContext({getUnifiedSheetsId,getSheetsSpreadsheetId,process});vm.runInContext(model+'\n'+fn,ctx);
 process.env.STOCKTRACE_OPERATIONS_SPREADSHEET_ID='operations-workbook-12345';
 assert.equal(vm.runInContext('Object.keys(SHEETS).length',ctx),14);
 assert.equal(vm.runInContext('new Set(Object.values(SHEETS).map(s=>s.tab)).size',ctx),14);
 assert.equal(vm.runInContext('Object.keys(SHEETS).every(t=>getSpreadsheetId(targetForTable(t))=== "operations-workbook-12345")',ctx),true);
});
