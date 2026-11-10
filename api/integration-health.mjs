// Safe diagnostic: reports configuration state and non-reversible target fingerprints only.
import { integrationHealth } from './_lib/stocktrace-config.mjs';
export default {
  async fetch(request) {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'GET only' }, { status: 405 });
    try {
      const report = integrationHealth();
      return Response.json(report, {
        status: report.ok ? 200 : 503,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
    } catch (error) {
      return Response.json({ ok: false, error: error.code || 'INTEGRATION_CONFIG_INVALID', message: error.message }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
    }
  }
};
