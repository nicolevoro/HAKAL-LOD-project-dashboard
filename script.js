/**
 * חכ"ל BI Dashboard — script.js
 *
 * To update project data: replace projects.json only.
 * To add a manager:       add an entry to managers.json.
 * No JavaScript changes needed.
 *
 * Architecture:
 *   AUTH    — login / logout / role-based filtering
 *   DATA    — fetch projects.json + managers.json
 *   FILTERS — dropdowns + getFiltered()
 *   CHARTS  — donuts, bar charts, risk charts
 *   TABLES  — build thead/tbody for all 3 tables
 *   MAP     — Leaflet map initialisation + markers
 *   NAV     — page switching
 *   MAIN    — update() wires everything together
 */

'use strict';

/* ════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════ */

const QS26 = ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'];

/** Colors for the milestone compliance badges and donut chart */
const COMP = {
  'בוצע':          { bg: '#166534', fg: '#fff',    ch: '#166534' },
  'בוצע חלקית':    { bg: '#4ade80', fg: '#14532d', ch: '#4ade80' },
  'לא בוצע':       { bg: '#dc2626', fg: '#fff',    ch: '#f87171' },
  'צפי לעמידה':    { bg: '#86efac', fg: '#14532d', ch: '#6ee7b7' },
  'צפי לאי עמידה': { bg: '#fda4af', fg: '#9f1239', ch: '#fda4af' },
};

/** Colors for the project-status donut */
const STAT_C = {
  'ביצוע':        '#065f46', 'מסירות':       '#059669',
  'תכנון מפורט':  '#1d4ed8', 'תכנון ראשוני': '#3b82f6',
  'תכנון סופי':   '#93c5fd', 'תכנון':        '#bfdbfe',
  'תכנון מוקדם':  '#dbeafe', 'התקשרות':      '#d97706',
  'טרם החל':      '#94a3b8', 'סטטוטוריקה':   '#7c3aed',
  '':             '#e5e7eb',
};

/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */

let ALL_PROJECTS = [];   // full project array (loaded from projects.json)
let ALL_MANAGERS = [];   // manager list (loaded from managers.json)
let CURRENT_USER = null; // { code, name, role }

// Expand/collapse state per table
let stInt   = {};
let stExt   = {};
let stEiruv = {};

// Chart instances (kept so we can destroy before re-creating)
const charts = {};

// Leaflet map
// Neighbourhood map (Leaflet instance, created once)
let NM_MAP     = null;
let NM_POLYGON = null;

/* ════════════════════════════════════════════════
   SAFE DOM HELPERS  (module-level, used everywhere)
════════════════════════════════════════════════ */

/** Safely set textContent — does nothing if element is missing */
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/** Safely set innerHTML — does nothing if element is missing */
function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/* ════════════════════════════════════════════════
   AUTH MODULE
════════════════════════════════════════════════ */

/** Attempt login with the code the user typed */
function doLogin() {
  const code  = document.getElementById('login-input').value.trim();
  const match = ALL_MANAGERS.find(m => m.code === code);

  if (!match) {
    document.getElementById('login-error').textContent = 'קוד גישה שגוי. נסה שוב.';
    document.getElementById('login-input').value = '';
    document.getElementById('login-input').focus();
    return;
  }

  // Persist session in localStorage so refresh doesn't log the user out
  localStorage.setItem('hakhal_user', JSON.stringify(match));
  _applyLogin(match);
}

/** Log the current user out and return to the login screen */
function doLogout() {
  localStorage.removeItem('hakhal_user');
  CURRENT_USER = null;
  document.getElementById('dashboard').classList.remove('visible');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-input').value = '';
  document.getElementById('login-error').textContent = '';
}

/**
 * Show the dashboard for a given user object.
 * Called after successful login or on page load if a session exists.
 */
function _applyLogin(user) {
  CURRENT_USER = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').classList.add('visible');

  // Admin sees all filter dropdowns; managers see only their own projects
  const filtersEl = document.getElementById('tb-filters');
  if (user.role === 'admin') {
    filtersEl.style.display = 'flex';
  } else {
    filtersEl.style.display = 'none';
  }

  // Initialise dropdowns then render
  _initDropdowns();
  _resetExpand();
  update();
}

/**
 * Filter the full project list according to the logged-in user.
 * Admin → all projects.
 * Manager → only projects where project.manager matches their name.
 */
function _userFilter(projects) {
  if (!CURRENT_USER || CURRENT_USER.role === 'admin') return projects;
  return projects.filter(r => r.manager === CURRENT_USER.name);
}

/* ════════════════════════════════════════════════
   DATA LOADING
════════════════════════════════════════════════ */

/**
 * Bootstrap: load both JSON files, then check for a saved session.
 * Called once on DOMContentLoaded.
 */
async function init() {
  try {
    const [projRes, mgrRes] = await Promise.all([
      fetch('projects.json'),
      fetch('managers.json'),
    ]);
    ALL_PROJECTS = await projRes.json();
    ALL_MANAGERS = await mgrRes.json();
  } catch (err) {
    alert('שגיאה בטעינת הנתונים. ודא שהקבצים projects.json ו-managers.json נמצאים בתיקייה.');
    console.error(err);
    return;
  }

  // Restore session if one exists
  const saved = localStorage.getItem('hakhal_user');
  if (saved) {
    const user = JSON.parse(saved);
    // Validate that the code still exists in managers.json
    const still = ALL_MANAGERS.find(m => m.code === user.code);
    if (still) {
      _applyLogin(still);
      return;
    }
  }

  // No session — show login
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-input').focus();
}

/* ════════════════════════════════════════════════
   FILTER MODULE
════════════════════════════════════════════════ */

/** Populate the Hood / PM / Status filter dropdowns (admin only) */
function _initDropdowns() {
  const visible = _userFilter(ALL_PROJECTS);
  const hoods = [], pms = [], sts = [], seen = {};

  visible.forEach(r => {
    if (r.neighborhood && !seen['h' + r.neighborhood]) { hoods.push(r.neighborhood); seen['h' + r.neighborhood] = 1; }
    if (r.manager      && !seen['m' + r.manager])      { pms.push(r.manager);        seen['m' + r.manager]      = 1; }
    if (r.status       && !seen['s' + r.status])       { sts.push(r.status);         seen['s' + r.status]       = 1; }
  });

  hoods.sort(); pms.sort(); sts.sort();

  function fill(id, arr) {
    const sel = document.getElementById(id);
    if (!sel) return; // element may not exist in current page layout
    while (sel.options.length > 1) sel.remove(1);
    arr.forEach(v => {
      const o = document.createElement('option');
      o.value = o.textContent = v;
      sel.appendChild(o);
    });
  }

  fill('fHood', hoods);
  fill('fPM',   pms);
  fill('fSt',   sts);
}

/** Read filter dropdowns and return matching projects */
function getFiltered() {
  const base = _userFilter(ALL_PROJECTS);
  if (CURRENT_USER && CURRENT_USER.role !== 'admin') return base; // no extra filters for managers

  const hood = document.getElementById('fHood').value;
  const pm   = document.getElementById('fPM').value;
  const st   = document.getElementById('fSt').value;

  return base.filter(r => {
    if (hood && r.neighborhood !== hood) return false;
    if (pm   && r.manager      !== pm)   return false;
    if (st   && r.status       !== st)   return false;
    return true;
  });
}

/** Reset all filter dropdowns to "All" */
function resetFilters() {
  ['fHood', 'fPM', 'fSt'].forEach(id => { document.getElementById(id).value = ''; });
  update();
}

/** Expand all rows in every table */
function _resetExpand() {
  stInt = {}; stExt = {}; stEiruv = {};
  ALL_PROJECTS.forEach(r => {
    stInt[r.id] = stExt[r.id] = stEiruv[r.id] = true;
  });
}

/* ════════════════════════════════════════════════
   UTILITY HELPERS
════════════════════════════════════════════════ */

/** HTML-escape a value */
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/** Return the CSS class for a project status badge */
function stCls(s) {
  s = (s || '').trim();
  if (s === 'ביצוע' || s === 'מסירות') return 'tag-g';
  if (s.includes('תכנון'))              return 'tag-b';
  if (s === 'טרם החל')                  return 'tag-gr';
  if (s === 'התקשרות')                  return 'tag-y';
  if (s === 'סטטוטוריקה')               return 'tag-p';
  return 'tag-gr';
}

/* ════════════════════════════════════════════════
   CHART MODULE
════════════════════════════════════════════════ */

/** Create (or re-create) a doughnut chart */
function _mkDonut(id, cutout) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  charts[id] = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderColor: '#fff', borderWidth: 2 }] },
    options: {
      cutout: cutout || '67%',
      responsive: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#1e293b', titleColor: '#f8fafc', bodyColor: '#9ca3af', rtl: true, padding: 10, cornerRadius: 8 },
      },
    },
  });
  return charts[id];
}

/** Render legend HTML for a donut */
function _mkLeg(id, labels, vals, colors, total) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = labels.map((l, i) => {
    const pct = total > 0 ? Math.round(vals[i] / total * 100) : 0;
    return `<div class="li"><div class="ld" style="background:${colors[i]}"></div><span class="ln">${esc(l)}</span><span class="lv">${vals[i]} (${pct}%)</span></div>`;
  }).join('');
}

/** Render a horizontal-bar list */
function _mkHBar(id, labels, vals, colors, maxVal) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = labels.map((l, i) => {
    const pct = maxVal > 0 ? Math.round(vals[i] / maxVal * 100) : 0;
    return `<div class="hbar-item"><div class="hbar-lbl"><span class="hbar-name">${esc(l)}</span><span class="hbar-num">${vals[i]}</span></div><div class="hbar-track"><div class="hbar-fill" style="width:${pct}%;background:${colors[i] || '#3b82f6'}"></div></div></div>`;
  }).join('');
}

/** Update status donut (internal projects) */
function _updateDonut1(internal) {
  const counts = {};
  internal.forEach(r => { const s = r.status || 'לא הוגדר'; counts[s] = (counts[s] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const labels  = entries.map(e => e[0]);
  const vals    = entries.map(e => e[1]);
  const colors  = labels.map(l => STAT_C[l] || '#e5e7eb');
  const total   = internal.length;

  if (!charts['d1']) _mkDonut('d1', '60%');
  charts['d1'].data.labels                   = labels;
  charts['d1'].data.datasets[0].data         = vals;
  charts['d1'].data.datasets[0].backgroundColor = colors;
  charts['d1'].update('none');

  document.getElementById('d1ctr').innerHTML =
    `<div class="dc-n">${total}</div><div class="dc-lbl">פנימי</div>`;
  _mkLeg('leg1', labels, vals, colors, total);
}

/** Update compliance donut + KPIs (internal projects) */
function _updateDonut2(internal) {
  let done = 0, due = 0;
  const cc = {};

  internal.forEach(r => {
    QS26.forEach(q => {
      const ms = r.plan[q], st = r.comp[q];
      if (ms && ms.text.trim()) {
        if (st && st.trim()) { cc[st] = (cc[st] || 0) + 1; due++; }
        if (st === 'בוצע') done++;
      }
    });
  });

  // KPIs
  set('kDone',    done);
  set('kDoneSub', due > 0 ? `מתוך ${due} שהיו אמורות` : '');
  set('kPct',     due > 0 ? `${Math.round(done / due * 100)}%` : '—');

  // Donut
  const ord    = ['בוצע','בוצע חלקית','לא בוצע','צפי לעמידה','צפי לאי עמידה'];
  const d2L    = ord.filter(s => cc[s]);
  const d2V    = d2L.map(s => cc[s]);
  const d2C    = d2L.map(s => COMP[s] ? COMP[s].ch : '#e5e7eb');
  const tot2   = d2V.reduce((a, b) => a + b, 0);

  if (!charts['d2']) _mkDonut('d2', '60%');
  charts['d2'].data.labels                      = d2L;
  charts['d2'].data.datasets[0].data            = d2V;
  charts['d2'].data.datasets[0].backgroundColor = d2C;
  charts['d2'].update('none');
  _mkLeg('leg2', d2L, d2V, d2C, tot2);
}

/** Update manager workload bar chart */
function _updateMgrBars(internal) {
  const mgc = {};
  internal.forEach(r => { if (r.manager) mgc[r.manager] = (mgc[r.manager] || 0) + 1; });
  const entries = Object.entries(mgc).sort((a, b) => b[1] - a[1]);
  const PURPS = ['#7c3aed','#8b5cf6','#a78bfa','#c4b5fd','#6d28d9','#4c1d95','#ddd6fe'];
  _mkHBar(
    'mgr-bars',
    entries.map(e => e[0]),
    entries.map(e => e[1]),
    PURPS,
    entries[0] ? entries[0][1] : 1,
  );
}

/* ════════════════════════════════════════════════
   TABLE MODULE
════════════════════════════════════════════════ */

/** HTML for a planned milestone cell, coloured by compliance */
function planCell(r, q) {
  const ms = r.plan[q], st = r.comp[q];
  if (!ms || !ms.text.trim()) return '<span class="ms-empty">—</span>';
  const c = st && COMP[st] ? COMP[st] : { bg: 'transparent', fg: '#1e293b' };
  return `<div class="ms-cell"><span class="ms-pill" style="background:${c.bg};color:${c.fg}">${esc(ms.text).replace(/\n/g,'<br>')}</span>${ms.month ? `<div class="ms-month">[${esc(ms.month)}]</div>` : ''}</div>`;
}

/** HTML for an actual-execution milestone cell (always white background) */
function execCell(r, q) {
  const ms = r.exec[q];
  if (!ms || !ms.text.trim()) return '<span class="ms-empty">—</span>';
  return `<div class="ms-cell"><span style="font-size:11px;color:#374151;line-height:1.45">${esc(ms.text).replace(/\n/g,'<br>')}</span>${ms.month ? `<div class="ms-month" style="color:#d97706">[${esc(ms.month)}]</div>` : ''}</div>`;
}

/** Build the <thead> row for a table */
function makeThead(isExt) {
  let h = '<tr><th style="min-width:180px">תת פרויקט</th>';
  if (isExt) h += '<th style="min-width:100px">גורם מבצע</th>';
  QS26.forEach(q => { h += `<th style="min-width:145px">${q}<br><small style="font-weight:400;opacity:.6">אבן דרך</small></th>`; });
  h += '<th style="min-width:72px">2027</th><th style="min-width:72px">2028</th>';
  h += '<th style="min-width:188px">חסמים / עיכובים</th>';
  if (!isExt) h += '<th style="min-width:168px">ניהול איחורים</th><th style="min-width:168px">ניהול חסמים</th>';
  h += '<th style="min-width:168px">הערות לדשבורד</th></tr>';
  return h;
}

/** Build all <tbody> rows for a table */
function makeRows(list, stObj, isExt, isEiruv) {
  if (!list.length) return '<tr><td colspan="20" style="text-align:center;padding:28px;color:#9ca3af;font-size:13px">אין פרויקטים תואמים</td></tr>';

  const extCls = isExt ? ' ext' : isEiruv ? ' eiruv' : '';
  let html = '';

  list.forEach(r => {
    const exp = stObj[r.id] !== false;

    // ── Group header row (click to expand/collapse) ──
    html += `<tr class="r-grp${extCls}" onclick="tog('${r.id}',${isExt},${isEiruv})">`;
    html += `<td colspan="20"><div class="grp-cell">`;
    html += `<div class="grp-btn" id="xi-${r.id}">${exp ? '▾' : '▸'}</div>`;
    html += `<span class="grp-name" title="${esc(r.sub || r.project)}">${esc((r.sub || r.project || '—').substring(0, 58))}</span>`;
    if (r.status)       html += `<span class="tag ${stCls(r.status)}">${esc(r.status)}</span>`;
    if (r.risk_score > 3) html += `<span class="rb rb-c" style="margin-right:4px">⚠ ${r.risk_score}</span>`;
    if (r.manager)      html += `<span class="grp-mgr">${esc(r.manager)}</span>`;
    html += `</div></td></tr>`;

    if (!exp) return; // collapsed — skip detail rows

    // ── Plan row ──
    html += `<tr class="r-plan${extCls}"><td class="row-lbl">תכנון</td>`;
    if (isExt) html += `<td>${r.supervisor ? `<span class="sup-badge">${esc(r.supervisor)}</span>` : ''}</td>`;
    QS26.forEach(q => { html += `<td>${planCell(r, q)}</td>`; });
    html += `<td class="yr-cell">${esc(r.yr2027).replace(/\n/g,'<br>')}</td>`;
    html += `<td class="yr-cell">${esc(r.yr2028).replace(/\n/g,'<br>')}</td>`;
    html += `<td class="blk-cell">${r.blockers ? esc(r.blockers).replace(/\n/g,'<br>') : '<span class="ms-empty">—</span>'}</td>`;
    if (!isExt) {
      html += `<td class="blk-cell">${r.delays_mgmt ? esc(r.delays_mgmt).replace(/\n/g,'<br>') : '<span class="ms-empty">—</span>'}</td>`;
      html += `<td class="blk-cell">${r.blocks_mgmt ? esc(r.blocks_mgmt).replace(/\n/g,'<br>') : '<span class="ms-empty">—</span>'}</td>`;
    }
    html += `<td class="blk-cell">${r.notes ? esc(r.notes).replace(/\n/g,'<br>') : '<span class="ms-empty">—</span>'}</td></tr>`;

    // ── Exec row ──
    html += `<tr class="r-exec"><td class="row-lbl exec">ביצוע</td>`;
    if (isExt) html += '<td></td>';
    QS26.forEach(q => { html += `<td>${execCell(r, q)}</td>`; });
    const empties = isExt ? 4 : 6;
    for (let i = 0; i < empties; i++) html += '<td></td>';
    html += '</tr>';
  });

  return html;
}

/** Toggle expand/collapse of a project row */
function tog(id, isExt, isEiruv) {
  const stObj = isExt ? stExt : isEiruv ? stEiruv : stInt;
  stObj[id] = stObj[id] === false ? true : false;

  const xi = document.getElementById(`xi-${id}`);
  if (xi) xi.textContent = stObj[id] === false ? '▸' : '▾';

  // Re-render only the affected table
  const f = getFiltered();
  const int   = f.filter(r => !r.is_ext && !r.is_eiruv);
  const ext   = f.filter(r =>  r.is_ext);
  const eiruv = f.filter(r =>  r.is_eiruv);

  if (isExt)   document.getElementById('tb-ext').innerHTML   = makeRows(ext,   stExt,   true,  false);
  else if (isEiruv) document.getElementById('tb-eiruv').innerHTML = makeRows(eiruv, stEiruv, false, true);
  else         document.getElementById('tb-int').innerHTML   = makeRows(int,   stInt,   false, false);
}

/* ════════════════════════════════════════════════
   RISK PAGE MODULE
════════════════════════════════════════════════ */

function _updateRisk(filtered) {
  // Top-10 by risk score
  const top = [...filtered]
    .sort((a, b) => b.risk_score - a.risk_score)
    .filter(r => r.risk_score > 0)
    .slice(0, 10);

  const rb = document.getElementById('risk-body');
  if (!rb) return;

  rb.innerHTML = top.map((r, i) => {
    const compStr = QS26.map(q => {
      const st = r.comp[q];
      if (!st) return '';
      const c = COMP[st];
      return `<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-size:9px;background:${c ? c.bg : '#e5e7eb'};color:${c ? c.fg : '#374151'}">${q.replace(' 2026', '')}:${st}</span>`;
    }).filter(Boolean).join(' ');

    const badge = r.risk_score >= 6 ? '<span class="rb rb-c">קריטי</span>'
                : r.risk_score >= 4 ? '<span class="rb rb-h">גבוה</span>'
                : r.risk_score >= 2 ? '<span class="rb rb-m">בינוני</span>'
                :                     '<span class="rb rb-l">נמוך</span>';

    const pips = Array(Math.min(r.risk_score, 9)).fill('<div class="pip on"></div>').join('')
               + Array(9 - Math.min(r.risk_score, 9)).fill('<div class="pip off"></div>').join('');

    return `<tr>
      <td style="font-weight:700;color:#6b7280">${i + 1}</td>
      <td><div class="rname">${esc((r.sub || r.project || '—').substring(0, 45))}</div><div class="rmgr">${esc(r.manager || '—')}</div></td>
      <td style="font-size:11px;color:#6b7280">${esc(r.manager || '—')}</td>
      <td>${badge}<div class="pips" style="margin-top:3px">${pips}</div></td>
      <td style="font-size:10px">${compStr}</td>
      <td style="font-size:10px;color:#6b7280;max-width:150px;white-space:normal">${esc((r.blockers || '—').substring(0, 55))}</td>
    </tr>`;
  }).join('');

  // Risk by manager
  const mr  = {};
  filtered.forEach(r => { if (r.manager && r.risk_score > 0) mr[r.manager] = (mr[r.manager] || 0) + r.risk_score; });
  const mre = Object.entries(mr).sort((a, b) => b[1] - a[1]);
  _mkBarChart('c-risk-mgr', mre.map(e => e[0]), mre.map(e => e[1]), 'rgba(220,38,38,.7)');

  // Risk by hood
  const hr  = {};
  filtered.forEach(r => { if (r.neighborhood && r.risk_score > 0) hr[r.neighborhood] = (hr[r.neighborhood] || 0) + r.risk_score; });
  const hre = Object.entries(hr).sort((a, b) => b[1] - a[1]).slice(0, 8);
  _mkBarChart('c-risk-hood', hre.map(e => e[0]), hre.map(e => e[1]), 'rgba(14,116,144,.7)');
}

/** Generic horizontal bar Chart.js chart */
function _mkBarChart(id, labels, vals, color) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return;
  charts[id] = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data: vals, backgroundColor: color, borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { rtl: true } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6b7280', font: { size: 10 } } },
        y: { ticks: { color: '#374151', font: { size: 11 } } },
      },
      animation: { duration: 300 },
    },
  });
}

/* ════════════════════════════════════════════════
   MAPS PAGE — Neighbourhood Map + Lot Information
   
   Layout  : Leaflet map (left) + lot-cards sidebar (right)
   Map data: geographic polygons for visual context — no fake per-lot coords
   Lot data: PDF-extracted developer / units / occupancy / buildings,
             embedded as NM_LOT_DATA below.
   Status  : from projects.json at runtime via _nmMatchProject().
════════════════════════════════════════════════ */

/* ── Lot data extracted from official PDF maps ── */
const NM_LOT_DATA = {

  nofei_ben_shemen: {
    name: 'נופי בן שמן',
    lots: [
      // Residential
      { key:'101',  label:'101',     type:'residential', developer:'אהרוני',       units:164, occupancy:'Q1/2027', buildings:[] },
      { key:'102',  label:'102',     type:'residential', developer:'',             units:196, occupancy:'',        buildings:[] },
      { key:'103',  label:'103',     type:'residential', developer:'אמורה',        units:166, occupancy:'Q3/2028', buildings:[] },
      { key:'104',  label:'104',     type:'residential', developer:'',             units:102, occupancy:'',        buildings:[] },
      { key:'105',  label:'105',     type:'residential', developer:'אפי קפיטל',   units:190, occupancy:'Q3/2027', buildings:[] },
      { key:'106',  label:'106',     type:'residential', developer:'אמורה',        units:166, occupancy:'',        buildings:[] },
      { key:'108',  label:'107+108', type:'residential', developer:'אהרוזדים',     units:402, occupancy:'Q3/2028', buildings:[] },
      { key:'109',  label:'109+110', type:'residential', developer:'שיקון ובינוי', units:247, occupancy:'Q3/2026', buildings:[] },
      { key:'111',  label:'111+112', type:'residential', developer:"פרסקוביץ'",   units:352, occupancy:'',        buildings:[] },
      { key:'113',  label:'113',     type:'residential', developer:'אמורה',        units:166, occupancy:'',        buildings:[] },
      { key:'114',  label:'114',     type:'residential', developer:'שיקון וביני',  units:168, occupancy:'',        buildings:[] },
      { key:'115',  label:'115+116', type:'residential', developer:'אהרוני',       units:274, occupancy:'Q1/2028', buildings:[] },
      { key:'117',  label:'117',     type:'residential', developer:'דוראל',        units:200, occupancy:'Q3/2026', buildings:[] },
      { key:'118',  label:'118',     type:'residential', developer:'שיקון ביני',   units:166, occupancy:'',        buildings:[] },
      { key:'119',  label:'119+120', type:'residential', developer:'אמורה',        units:168, occupancy:'',        buildings:[] },
      { key:'121',  label:'121+122', type:'residential', developer:'אהרוני',       units:274, occupancy:'Q1/2028', buildings:[] },
      { key:'123',  label:'123+124', type:'residential', developer:'אפי קפיטל',   units:196, occupancy:'Q3/2028', buildings:[] },
      { key:'1050', label:'1050',    type:'residential', developer:'עץ השקד',      units:132, occupancy:'Q2/2028', buildings:[] },
      { key:'150',  label:'150',     type:'residential', developer:'',             units:300, occupancy:'',        buildings:[] },
      // Public
      { key:'100', label:'100', type:'public', developer:'', units:144, occupancy:'', buildings:['מבנה ציבור'] },
      { key:'400', label:'400', type:'public', developer:'', units:0,   occupancy:'', buildings:['מבנה ציבור'] },
      { key:'401', label:'401', type:'public', developer:'', units:0,   occupancy:'', buildings:['4 כיתות גן', 'בית כנסת'] },
      { key:'402', label:'402', type:'public', developer:'', units:0,   occupancy:'', buildings:['6 כיתות גן'] },
      { key:'403', label:'403', type:'public', developer:'', units:0,   occupancy:'', buildings:['בי"ס יסודי 24 כיתות', 'אולם ספורט', 'מסחר', 'מקווה'] },
      { key:'404', label:'404', type:'public', developer:'', units:0,   occupancy:'', buildings:['בי"ס יסודי 24 כיתות', '4 כיתות גן', 'מסחר', 'מועדון נוער'] },
      { key:'405', label:'405', type:'public', developer:'', units:0,   occupancy:'', buildings:['6 כיתות גן'] },
      { key:'406', label:'406', type:'public', developer:'', units:0,   occupancy:'', buildings:['בי"ס תיכון 54 כיתות', 'מעון יום', 'אולם ספורט', 'מבנה רב תכליתי'] },
      { key:'407', label:'407', type:'public', developer:'', units:0,   occupancy:'', buildings:['מעונות יום', '6 כיתות'] },
      { key:'408', label:'408', type:'public', developer:'', units:0,   occupancy:'', buildings:['בי"ס יסודי 18 כיתות', '3 כיתות גן', 'מגרש ספורט', 'בית כנסת'] },
    ],
  },

  harofev_beinleumi: {
    name: 'הרובע הבינלאומי',
    lots: [
      // Public / educational
      { key:'4002', label:'4002', type:'public', developer:'', units:0, occupancy:'', buildings:['בי"ס תיכון 42 כיתות', '12 כיתות חינוך מיוחד'] },
      { key:'4004', label:'4004', type:'public', developer:'', units:0, occupancy:'', buildings:['מתחם ציבורי'] },
      { key:'4007', label:'4007', type:'public', developer:'', units:0, occupancy:'', buildings:['4 כיתות גן', 'בית כנסת'] },
      { key:'4008', label:'4008', type:'public', developer:'', units:0, occupancy:'', buildings:['6 מעונות יום שיקומיים'] },
      { key:'4009', label:'4009', type:'public', developer:'', units:0, occupancy:'', buildings:['3 מעונות יום', '4 גני ילדים'] },
      { key:'4010', label:'4010', type:'public', developer:'', units:0, occupancy:'', buildings:['ריכוז בתי כנסת'] },
      { key:'4011', label:'4011', type:'public', developer:'', units:0, occupancy:'', buildings:['בי"ס יסודי 18 כיתות'] },
      { key:'4012', label:'4012', type:'public', developer:'', units:0, occupancy:'', buildings:['בי"ס יסודי 24 כיתות', 'מועדון נוער'] },
      { key:'4014', label:'4014', type:'public', developer:'', units:0, occupancy:'', buildings:['24 כיתות בתי ספר יסודיים', 'מקווה'] },
      { key:'4021', label:'4021', type:'public', developer:'', units:0, occupancy:'', buildings:['3 מעונות יום', '4 גני ילדים', 'בית כנסת'] },
      { key:'4022', label:'4022', type:'public', developer:'', units:0, occupancy:'', buildings:['3 כיתות גן', 'בית כנסת'] },
      { key:'4023', label:'4023', type:'public', developer:'', units:0, occupancy:'', buildings:['6 מעונות יום', '4 גני ילדים', 'מועדון נוער'] },
      { key:'4030', label:'4030', type:'residential', developer:'', units:0, occupancy:'', buildings:[] },
      // Mixed use
      { key:'303', label:'303', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'304', label:'304', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'306', label:'306', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'312', label:'312', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'313', label:'313', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'314', label:'314', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'316', label:'316', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'323', label:'323', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'324', label:'324', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'339', label:'339', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'341', label:'341', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
      { key:'342', label:'342', type:'mixed', developer:'', units:0, occupancy:'', buildings:['עירוב שימושים'] },
    ],
  },
};

/* ── Geographic neighbourhood bounds (for Leaflet polygon) ── */
const NM_BOUNDS = {
  nofei_ben_shemen:  { polygon:[[31.980,34.872],[31.980,34.893],[31.962,34.893],[31.962,34.872]], center:[31.971,34.882], zoom:15, color:'#1d4ed8' },
  harofev_beinleumi: { polygon:[[31.961,34.880],[31.961,34.907],[31.940,34.907],[31.940,34.880]], center:[31.951,34.893], zoom:15, color:'#7c3aed' },
};

/* ── Runtime state ── */
let NM_ACTIVE_HOOD = 'nofei_ben_shemen';
let NM_TYPE_FILTER = 'all';

/* ── Initialise the Maps page ── */
function initNeighbourhoodMap() {
  // Build neighbourhood tab buttons (once)
  const tabsEl = document.getElementById('nm-tabs');
  if (tabsEl && tabsEl.childElementCount === 0) {
    Object.entries(NM_LOT_DATA).forEach(([id, hood], i) => {
      const btn = document.createElement('button');
      btn.className = 'nm-tab' + (i === 0 ? ' active' : '');
      btn.textContent = hood.name;
      btn.onclick = () => nmSelectHood(id);
      tabsEl.appendChild(btn);
    });
  }
  // Build type-filter buttons (once)
  const ftEl = document.getElementById('nm-type-filters');
  if (ftEl && ftEl.childElementCount === 0) {
    [['all','הכל'],['residential','מגורים'],['public','ציבורי'],['mixed','עירוב שימושים']]
      .forEach(([v, lbl]) => {
        const btn = document.createElement('button');
        btn.className = 'nm-ftype' + (v === 'all' ? ' active' : '');
        btn.textContent = lbl;
        btn.dataset.v   = v;
        btn.onclick     = () => nmTypeFilter(v);
        ftEl.appendChild(btn);
      });
  }
  // Init Leaflet map (once)
  if (!NM_MAP) {
    NM_MAP = L.map('nmMapEl');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(NM_MAP);
  }
  nmRenderAll();
}

function nmSelectHood(id) {
  NM_ACTIVE_HOOD = id;
  document.querySelectorAll('.nm-tab').forEach(b =>
    b.classList.toggle('active', b.textContent === NM_LOT_DATA[id].name)
  );
  nmClosePanel();
  nmRenderAll();
}

function nmTypeFilter(val) {
  NM_TYPE_FILTER = val;
  document.querySelectorAll('.nm-ftype').forEach(b =>
    b.classList.toggle('active', b.dataset.v === val)
  );
  nmRenderGrid();
}

function nmRenderAll() {
  nmRenderMap();
  nmRenderGrid();
}

/* ── Render the Leaflet map with neighbourhood polygon ── */
function nmRenderMap() {
  if (!NM_MAP) return;
  const bounds = NM_BOUNDS[NM_ACTIVE_HOOD];
  const hood   = NM_LOT_DATA[NM_ACTIVE_HOOD];
  if (!bounds || !hood) return;

  // Remove old polygon
  if (NM_POLYGON) { NM_POLYGON.remove(); NM_POLYGON = null; }

  // Draw neighbourhood boundary polygon
  NM_POLYGON = L.polygon(bounds.polygon, {
    color: bounds.color, fillColor: bounds.color,
    fillOpacity: 0.12, weight: 2.5, dashArray: null,
  }).addTo(NM_MAP);

  // Summary popup on polygon click
  const resLots    = hood.lots.filter(l => l.type === 'residential');
  const totalUnits = resLots.reduce((s, l) => s + (l.units || 0), 0);
  NM_POLYGON.bindPopup(
    `<div dir="rtl" style="font-family:'Noto Sans Hebrew',sans-serif;min-width:160px">
      <div style="font-size:14px;font-weight:800;color:${bounds.color};margin-bottom:6px">${hood.name}</div>
      <div style="font-size:12px;color:#374151">${hood.lots.length} מגרשים</div>
      ${totalUnits ? `<div style="font-size:12px;color:#374151">${totalUnits.toLocaleString()} יח"ד מגורים</div>` : ''}
      <div style="font-size:11px;color:#6b7280;margin-top:6px">← בחר מגרש מהרשימה לפרטים</div>
    </div>`
  );

  NM_MAP.setView(bounds.center, bounds.zoom);
  setTimeout(() => NM_MAP.invalidateSize(), 200);
}

/* ── Render the lot card list ── */
function nmRenderGrid() {
  const hood = NM_LOT_DATA[NM_ACTIVE_HOOD];
  const grid = document.getElementById('nm-grid');
  if (!grid || !hood) return;

  const lots = hood.lots.filter(l =>
    NM_TYPE_FILTER === 'all' || l.type === NM_TYPE_FILTER
  );
  if (!lots.length) {
    grid.innerHTML = '<div class="nm-empty">אין מגרשים תואמים לסינון</div>';
    return;
  }

  grid.innerHTML = lots.map(lot => {
    const projects = _nmMatchProject(lot);
    const color    = _nmStatusColor(projects, lot);
    const typeIcon = lot.type === 'public' ? '🏛️' : lot.type === 'mixed' ? '🏙️' : '🏠';
    const statusTx = projects.length
      ? esc(projects[0].status || '—')
      : lot.type === 'mixed' ? 'עירוב שימושים' : lot.type === 'public' ? 'ציבורי' : '—';

    return `<div class="nm-card" data-key="${esc(lot.key)}"
                 style="border-top:3px solid ${color}"
                 onclick="nmShowLot('${esc(lot.key)}')">
      <div class="nm-card-hdr">
        <span class="nm-card-num">${typeIcon} ${esc(lot.label)}</span>
        <span class="nm-card-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${statusTx}</span>
      </div>
      ${lot.developer ? `<div class="nm-card-row">👷 ${esc(lot.developer)}</div>` : ''}
      ${lot.units     ? `<div class="nm-card-row">🏘️ ${lot.units} יח"ד</div>` : ''}
      ${lot.occupancy ? `<div class="nm-card-row">📅 ${esc(lot.occupancy)}</div>` : ''}
      ${lot.buildings.length ? `<div class="nm-card-row">🏛️ ${esc(lot.buildings[0])}${lot.buildings.length > 1 ? ` +${lot.buildings.length-1}` : ''}</div>` : ''}
    </div>`;
  }).join('');
}

/* ── Open lot detail panel ── */
function nmShowLot(key) {
  const hood = NM_LOT_DATA[NM_ACTIVE_HOOD];
  const lot  = hood && hood.lots.find(l => l.key === key);
  if (!lot) return;

  const projects  = _nmMatchProject(lot);
  const typeLabel = lot.type === 'public' ? 'מבנה ציבורי' : lot.type === 'mixed' ? 'עירוב שימושים' : 'מגורים';

  set('nm-panel-title', `מגרש ${lot.label}`);
  set('nm-panel-sub',   `${hood.name} · ${typeLabel}`);

  document.querySelectorAll('.nm-card').forEach(c =>
    c.classList.toggle('nm-card-selected', c.dataset.key === key)
  );

  const body = document.getElementById('nm-panel-body');
  if (!body) return;
  let html = '';

  /* PDF data */
  html += `<div class="nm-block"><div class="nm-block-title">מידע מהמפה הרשמית</div>`;
  if (lot.developer) html += _nmRow('יזם / קבלן', lot.developer);
  if (lot.units)     html += _nmRow('יחידות דיור', `${lot.units} יח"ד`);
  if (lot.occupancy) html += _nmRow('אכלוס משוער', lot.occupancy);
  html += _nmRow('סוג מגרש', typeLabel);
  if (lot.buildings.length) {
    html += `<div class="nm-row"><span class="nm-row-label">מבני ציבור</span>
      <div class="nm-tags">${lot.buildings.map(b => `<span class="nm-tag">${esc(b)}</span>`).join('')}</div></div>`;
  }
  html += '</div>';

  /* Live project data */
  if (projects.length) {
    html += `<div class="nm-block"><div class="nm-block-title">נתוני projects.json (${projects.length})</div>`;
    projects.forEach(p => {
      const stHex   = _nmStatusHex(p.status);
      const msCells = QS26.map(q => {
        const ms = p.plan[q], st = p.comp[q];
        const c  = st && COMP[st] ? COMP[st] : null;
        if (!ms || !ms.text.trim()) return '';
        return `<div class="nm-ms-cell"${c ? ` style="border-color:${c.bg}"` : ''}>
          <div class="nm-ms-q">${q.replace(' 2026','')}${st ? ` · ${st}` : ''}</div>
          <div class="nm-ms-txt">${esc(ms.text)}</div>
        </div>`;
      }).filter(Boolean).join('');

      const futureYrs = [
        p.yr2027 ? _nmRow('2027', p.yr2027) : '',
        p.yr2028 ? _nmRow('2028', p.yr2028) : '',
        p.yr2029 ? _nmRow('2029', p.yr2029) : '',
      ].join('');

      html += `<div class="nm-proj-card">
        <div class="nm-proj-name">${esc(p.sub || p.project || '—')}</div>
        <div class="nm-row"><span class="nm-row-label">סטטוס</span>
          <span class="nm-status-badge" style="background:${stHex}22;color:${stHex};border:1px solid ${stHex}44">${esc(p.status||'—')}</span>
        </div>
        ${_nmRow('מנהל', p.manager)}
        ${p.supervisor  ? _nmRow('גורם מבצע', p.supervisor)     : ''}
        ${p.blockers    ? `<div class="nm-row"><span class="nm-row-label">חסמים</span>
            <span class="nm-row-value" style="color:var(--danger)">${esc(p.blockers)}</span></div>` : ''}
        ${p.notes       ? _nmRow('הערות', p.notes)              : ''}
        ${p.delays_mgmt ? _nmRow('ניהול איחורים', p.delays_mgmt): ''}
        ${msCells ? `<div style="margin-top:8px">
          <div class="nm-block-title" style="margin-bottom:4px">אבני דרך 2026</div>
          <div class="nm-ms-grid">${msCells}</div></div>` : ''}
        ${futureYrs ? `<div style="margin-top:8px">
          <div class="nm-block-title" style="margin-bottom:4px">יעדים עתידיים</div>
          ${futureYrs}</div>` : ''}
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div class="nm-empty">אין פרויקט מקושר למגרש זה ב-projects.json</div>';
  }

  body.innerHTML = html;
  document.getElementById('nm-panel').classList.add('open');
}

function nmClosePanel() {
  const el = document.getElementById('nm-panel');
  if (el) el.classList.remove('open');
  document.querySelectorAll('.nm-card').forEach(c => c.classList.remove('nm-card-selected'));
}

/* ── Helpers ── */
function _nmMatchProject(lot) {
  const visible = new Set(_userFilter(ALL_PROJECTS).map(p => p.id));
  return ALL_PROJECTS.filter(p => {
    if (!visible.has(p.id)) return false;
    const sub = p.sub || '';
    const m   = sub.match(/מגרש\s+(\d+)/);
    if (m && m[1] === lot.key) return true;
    if (lot.label.length > 1 && sub.includes(lot.label)) return true;
    return false;
  });
}

function _nmStatusColor(projects, lot) {
  if (!projects.length) {
    if (lot.type === 'public')  return '#6b7280';
    if (lot.type === 'mixed')   return '#8b5cf6';
    return '#e5e7eb';
  }
  let best = { color: '#94a3b8', pri: 0 };
  projects.forEach(p => {
    const st   = (p.status || '').trim();
    const risk = Object.values(p.comp || {}).some(s => s === 'לא בוצע' || s === 'צפי לאי עמידה');
    let c = '#94a3b8', pri = 1;
    if (risk)                                    { c = '#dc2626'; pri = 6; }
    else if (st === 'מסירות' || st === 'הסתיים') { c = '#059669'; pri = 5; }
    else if (st === 'ביצוע')                     { c = '#1d4ed8'; pri = 4; }
    else if (st === 'התקשרות')                   { c = '#0891b2'; pri = 3; }
    else if (st.includes('תכנון'))               { c = '#d97706'; pri = 2; }
    if (pri > best.pri) best = { color: c, pri };
  });
  return best.color;
}

function _nmStatusHex(st) {
  st = (st || '').trim();
  if (st === 'מסירות' || st === 'הסתיים') return '#059669';
  if (st === 'ביצוע')                     return '#1d4ed8';
  if (st === 'התקשרות')                   return '#0891b2';
  if (st.includes('תכנון'))               return '#d97706';
  if (st === 'טרם החל')                   return '#94a3b8';
  return '#6b7280';
}

function _nmRow(label, value) {
  if (!value) return '';
  return `<div class="nm-row"><span class="nm-row-label">${esc(label)}</span><span class="nm-row-value">${esc(String(value))}</span></div>`;
}

function _isAdmin() {
  return CURRENT_USER && CURRENT_USER.role === 'admin';
}


/* ════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════ */

function nav(page) {
  ['dash', 'risk', 'map'].forEach(p => {
    document.getElementById(`page-${p}`).classList.toggle('active', p === page);
    document.getElementById(`nav-${p}`).classList.toggle('active', p === page);
  });
  if (page === 'map')  initNeighbourhoodMap();
  if (page === 'risk') _updateRisk(getFiltered());
}

/* ════════════════════════════════════════════════
   MAIN UPDATE
   Called whenever a filter changes or data loads.
════════════════════════════════════════════════ */

function update() {
  try {
    const filtered = getFiltered();
    const internal = filtered.filter(r => !r.is_ext && !r.is_eiruv);
    const external = filtered.filter(r =>  r.is_ext);
    const eiruv    = filtered.filter(r =>  r.is_eiruv);

    // ── Topbar ──
    set('hbadge',      `${filtered.length} פרויקטים`);
    set('tb-subtitle', `${internal.length} פנימי · ${external.length} גורמי חוץ · ${eiruv.length} עירוב שימושים`);

    // ── KPIs ──
    set('kTotal',    filtered.length);
    set('kTotalSub', `${internal.length} פנימי · ${external.length} חיצוני · ${eiruv.length} עירוב`);

    let atRisk = 0, blocked = 0;
    internal.forEach(r => {
      if (r.blockers) blocked++;
      QS26.forEach(q => {
        const st = r.comp[q];
        if (st === 'לא בוצע' || st === 'צפי לאי עמידה') atRisk++;
      });
    });
    set('kRisk',    atRisk);
    set('kBlocked', blocked);

    // ── Charts (each isolated so one failure won't block tables) ──
    try { _updateDonut1(internal);  } catch (e) { console.error('donut1:', e); }
    try { _updateDonut2(internal);  } catch (e) { console.error('donut2:', e); }
    try { _updateMgrBars(internal); } catch (e) { console.error('mgrBars:', e); }

    // ── Tables ──
    set('cnt-int',   internal.length);
    set('cnt-ext',   external.length);
    set('cnt-eiruv', eiruv.length);

    try {
      setHTML('th-int',   makeThead(false));
      setHTML('tb-int',   makeRows(internal, stInt,   false, false));
      setHTML('th-ext',   makeThead(true));
      setHTML('tb-ext',   makeRows(external, stExt,   true,  false));
      setHTML('th-eiruv', makeThead(false));
      setHTML('tb-eiruv', makeRows(eiruv,   stEiruv, false, true));
    } catch (e) { console.error('tables:', e); }

    // ── Risk page ──
    const riskPage = document.getElementById('page-risk');
    if (riskPage && riskPage.classList.contains('active')) {
      try { _updateRisk(filtered); } catch (e) { console.error('risk:', e); }
    }


  } catch (e) {
    console.error('update() failed:', e);
  }
}

/* ════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', init);
