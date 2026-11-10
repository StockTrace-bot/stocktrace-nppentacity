import { createHash } from 'node:crypto';
/**
 * StockTrace single source of truth for external integration targets.
 *
 * Preferred Vercel setting (one value for all four destinations):
 * STOCKTRACE_INTEGRATION_TARGETS_JSON={
 *   "drive":{"r1FolderId":"...","intakeFolderId":"..."},
 *   "sheets":{"r1SpreadsheetId":"...","intakeSpreadsheetId":"..."}
 * }
 *
 * Existing credential variables remain server-side and are intentionally not
 * duplicated into this JSON. Legacy target variables remain supported only as
 * a backward-compatible fallback when the JSON variable is absent.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

function configError(message, code = 'INTEGRATION_CONFIG_INVALID') {
  return Object.assign(new Error(message), { status: 503, code });
}

function readTargets() {
  const raw = String(process.env.STOCKTRACE_INTEGRATION_TARGETS_JSON || '').trim();
  if (raw) {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw configError('STOCKTRACE_INTEGRATION_TARGETS_JSON bukan JSON valid.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw configError('STOCKTRACE_INTEGRATION_TARGETS_JSON harus berupa objek JSON.');
    }
    return {
      source: 'STOCKTRACE_INTEGRATION_TARGETS_JSON',
      drive: {
        r1FolderId: String(parsed.drive?.r1FolderId || '').trim(),
        intakeFolderId: String(parsed.drive?.intakeFolderId || '').trim()
      },
      sheets: {
        r1SpreadsheetId: String(parsed.sheets?.r1SpreadsheetId || '').trim(),
        intakeSpreadsheetId: String(parsed.sheets?.intakeSpreadsheetId || '').trim()
      }
    };
  }
  return {
    source: 'legacy_environment_variables',
    drive: {
      r1FolderId: String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim(),
      intakeFolderId: String(process.env.GOOGLE_DRIVE_INTAKE_FOLDER_ID || '').trim()
    },
    sheets: {
      r1SpreadsheetId: String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim(),
      intakeSpreadsheetId: String(process.env.GOOGLE_SHEETS_PENERIMAAN_SPREADSHEET_ID || '').trim()
    }
  };
}

function validateId(value, label) {
  if (!ID_PATTERN.test(value || '')) {
    throw configError(`${label} belum valid. Masukkan ID saja, bukan URL lengkap.`, 'INTEGRATION_TARGET_MISSING');
  }
  return value;
}

export function getIntegrationTargets() {
  const targets = readTargets();
  for (const [key, label] of [
    ['r1FolderId', 'Folder Drive bukti kasus R1'],
    ['intakeFolderId', 'Folder Drive bukti penerimaan'],
    ['r1SpreadsheetId', 'Spreadsheet R1'],
    ['intakeSpreadsheetId', 'Spreadsheet penerimaan']
  ]) {
    const group = key.toLowerCase().includes('folder') ? targets.drive : targets.sheets;
    validateId(group[key], label);
  }
  if (targets.drive.r1FolderId === targets.drive.intakeFolderId) {
    throw configError('Folder Drive bukti kasus dan bukti penerimaan harus berbeda.', 'DRIVE_FOLDER_COLLISION');
  }
  if (targets.sheets.r1SpreadsheetId === targets.sheets.intakeSpreadsheetId) {
    throw configError('Spreadsheet R1 dan penerimaan harus berbeda sesuai pemetaan StockTrace V2.1.', 'SHEETS_TARGET_COLLISION');
  }
  return targets;
}

export function getDriveFolderId(kind) {
  const targets = readTargets();
  const value = kind === 'intake' ? targets.drive.intakeFolderId : kind === 'r1' ? targets.drive.r1FolderId : '';
  const label = kind === 'intake' ? 'Folder Drive bukti penerimaan' : 'Folder Drive bukti kasus R1';
  validateId(value, label);
  if (targets.drive.r1FolderId && targets.drive.intakeFolderId && targets.drive.r1FolderId === targets.drive.intakeFolderId) {
    throw configError('Folder Drive bukti kasus dan bukti penerimaan harus berbeda.', 'DRIVE_FOLDER_COLLISION');
  }
  return value;
}

export function getSheetsSpreadsheetId(kind) {
  const targets = readTargets();
  const value = kind === 'intake' ? targets.sheets.intakeSpreadsheetId : kind === 'r1' ? targets.sheets.r1SpreadsheetId : '';
  const label = kind === 'intake' ? 'Spreadsheet penerimaan' : 'Spreadsheet R1';
  validateId(value, label);
  if (targets.sheets.r1SpreadsheetId && targets.sheets.intakeSpreadsheetId && targets.sheets.r1SpreadsheetId === targets.sheets.intakeSpreadsheetId) {
    throw configError('Spreadsheet R1 dan penerimaan harus berbeda sesuai pemetaan StockTrace V2.1.', 'SHEETS_TARGET_COLLISION');
  }
  return value;
}

export function getSupabaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    publishableKey: String(process.env.SUPABASE_PUBLISHABLE_KEY || ''),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '')
  };
}

export function getGoogleOAuthConfig() {
  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || ''),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || ''),
    refreshToken: String(process.env.GOOGLE_REFRESH_TOKEN || '')
  };
}

export function getGoogleSheetsServiceAccount() {
  let credentials;
  try { credentials = JSON.parse(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || ''); }
  catch { throw configError('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON bukan JSON valid.', 'GOOGLE_CREDENTIALS_BAD_JSON'); }
  if (credentials?.type !== 'service_account' || !credentials.private_key || !credentials.client_email) {
    throw configError('JSON Service Account tidak memuat type, private_key, atau client_email.', 'GOOGLE_CREDENTIALS_INCOMPLETE');
  }
  return credentials;
}

export function getWebhookSecret() {
  return String(process.env.STOCKTRACE_SHEETS_WEBHOOK_SECRET || '');
}

export function integrationHealth() {
  const targets = readTargets();
  const supabase = getSupabaseConfig();
  const oauth = getGoogleOAuthConfig();
  let serviceAccountReady = false;
  try { getGoogleSheetsServiceAccount(); serviceAccountReady = true; } catch { /* redacted health only */ }
  const valid = value => ID_PATTERN.test(value || '');
  const fingerprint = value => value ? `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 12)}` : null;
  const projectRef = (() => {
    try { return new URL(supabase.url).hostname.split('.')[0] || null; } catch { return null; }
  })();
  const driveDistinct = !!targets.drive.r1FolderId && !!targets.drive.intakeFolderId && targets.drive.r1FolderId !== targets.drive.intakeFolderId;
  const sheetsDistinct = !!targets.sheets.r1SpreadsheetId && !!targets.sheets.intakeSpreadsheetId && targets.sheets.r1SpreadsheetId !== targets.sheets.intakeSpreadsheetId;
  const checks = {
    supabase: !!supabase.url && !!supabase.publishableKey,
    supabaseServiceRole: !!supabase.serviceRoleKey,
    googleOAuth: !!oauth.clientId && !!oauth.clientSecret && !!oauth.refreshToken,
    googleSheetsServiceAccount: serviceAccountReady,
    webhookSecret: !!getWebhookSecret(),
    driveR1: valid(targets.drive.r1FolderId),
    driveIntake: valid(targets.drive.intakeFolderId),
    driveFoldersDistinct: driveDistinct,
    sheetsR1: valid(targets.sheets.r1SpreadsheetId),
    sheetsIntake: valid(targets.sheets.intakeSpreadsheetId),
    sheetsDistinct
  };
  return {
    ok: Object.values(checks).every(Boolean),
    environment: process.env.VERCEL_ENV || 'local',
    targetConfigSource: targets.source,
    supabaseProjectRef: projectRef,
    checks,
    fingerprints: {
      driveR1: fingerprint(targets.drive.r1FolderId),
      driveIntake: fingerprint(targets.drive.intakeFolderId),
      sheetsR1: fingerprint(targets.sheets.r1SpreadsheetId),
      sheetsIntake: fingerprint(targets.sheets.intakeSpreadsheetId)
    }
  };
}

