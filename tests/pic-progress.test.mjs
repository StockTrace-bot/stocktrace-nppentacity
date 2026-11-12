import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('index.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const sql=fs.readFileSync('sql/14_PIC_PROGRESS_UPDATE.sql','utf8');

test('PIC progress editor is inside the shared case detail, not Leader-only sidebar',()=>{
  assert.match(html,/id="detailMainCard"/);
  assert.match(html,/id="panelPICProgress"/);
  assert.match(html,/id="picProgressEditor"/);
  assert.match(html,/onclick="savePICProgress\(\)"/);
  assert.ok(html.indexOf('id="panelPICProgress"')<html.indexOf('id="detailLeaderColumn"'));
});

test('frontend shows edit controls only to the assigned PIC and keeps Leader decision separate',()=>{
  assert.match(app,/String\(c\.pic_id\)===String\(activeUser\?\.id\)/);
  assert.match(app,/editor\.classList\.toggle\('hidden',!canEdit\)/);
  assert.match(app,/stocktrace_update_pic_progress/);
  const progressHandler=app.slice(app.indexOf('async function savePICProgress'),app.indexOf('async function downloadEvidence'));
  assert.doesNotMatch(progressHandler,/\.update\s*\(|p_status\s*:/);
  assert.match(app,/loadPICProgress\(id,c\)/);
});

test('database accepts progress only from the currently assigned PIC',()=>{
  assert.match(sql,/v_pic IS DISTINCT FROM auth\.uid\(\)/);
  assert.match(sql,/Hanya PIC yang ditugaskan/);
  assert.match(sql,/v_case_status='Selesai'/);
  assert.match(sql,/Pembaruan progres PIC:/);
});

test('PIC progress storage is read-only to browser and never changes final case status',()=>{
  assert.match(sql,/REVOKE ALL ON TABLE public\.stocktrace_pic_progress FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT SELECT ON TABLE public\.stocktrace_pic_progress TO authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.stocktrace_update_pic_progress\(text,text,text\) TO authenticated/);
  assert.doesNotMatch(sql,/UPDATE public\.cases\s+SET\s+status_kasus/i);
  assert.doesNotMatch(sql,/DELETE FROM|TRUNCATE|DROP TABLE/i);
});
