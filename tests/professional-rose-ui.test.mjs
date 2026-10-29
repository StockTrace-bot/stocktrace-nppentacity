import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync('index.html','utf8');
const login=fs.readFileSync('login.html','utf8');
const js=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('stocktrace-professional-rose.css','utf8');
test('desktop navy sidebar retained',()=>assert.match(html,/aside class="st-sidebar w-64 bg-npnavy/));
test('desktop four KPI cards retained',()=>assert.match(html,/grid grid-cols-2 xl:grid-cols-4/));
test('cases and archive remain semantic tables',()=>{assert.match(html,/<tbody id="dashboardCasesBody"><\/tbody>/);assert.match(html,/<tbody id="archiveBody"><\/tbody>/);assert.match(js,/<tr class="border-b">/);});
test('all five nav sections exist exactly once in permanent left sidebar',()=>{for(const id of ['dashboard','form-laporan','archive','reports','account'])assert.equal((html.match(new RegExp('data-nav-view="'+id+'"','g'))||[]).length,1);assert.match(html, /class="st-sidebar/);assert.doesNotMatch(html, /<nav class="mobile-bottom-nav/);});
test('rose stylesheet limited, no obsolete pink layout',()=>{assert.match(html,/stocktrace-professional-rose.css/);assert.match(login,/stocktrace-professional-rose.css/);assert.doesNotMatch(html,/stocktrace-pink-theme.css|st-unified-nav|st-case-list/);assert.match(css,/--st-navy:#1E293B/);});
test('V2 account/password and direct upload remain',()=>{assert.match(html,/id="passwordChangeForm"/);assert.match(js,/drive-upload|directUpload|resumable/i);});

test('mobile keeps sidebar on LEFT, not a bottom dock',()=>{assert.match(css, /\.st-sidebar \{ flex-basis:128px; width:128px; \}/);assert.match(css, /\.st-sidebar \{ flex-basis:110px; width:110px; \}/);assert.match(css, /\.mobile-bottom-nav,\.mobile-signout \{ display:none!important; \}/);});
test('report button remains right of dashboard heading',()=>{assert.match(html, /class="st-dashboard-heading /);assert.match(html, /class="st-dashboard-action /);assert.match(css, /\.st-dashboard-heading \{ display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:nowrap!important/);});
