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
let mapInst    = null;
let mapMarkers = [];

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
    // Clear existing options except the first ("הכל")
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
  fill('mfPM',  pms);
  fill('mfSt',  sts);
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
  let def = 0, done = 0, due = 0;
  const cc = {};

  internal.forEach(r => {
    QS26.forEach(q => {
      const ms = r.plan[q], st = r.comp[q];
      if (ms && ms.text.trim()) {
        def++;
        if (st && st.trim()) { cc[st] = (cc[st] || 0) + 1; due++; }
        if (st === 'בוצע') done++;
      }
    });
  });

  // KPIs
  document.getElementById('kDone').textContent    = done;
  document.getElementById('kDoneSub').textContent = due > 0 ? `מתוך ${due} שהיו אמורות` : '';
  document.getElementById('kPct').textContent     = due > 0 ? `${Math.round(done / due * 100)}%` : '—';
  document.getElementById('kDef').textContent     = def;

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
   MAP MODULE
════════════════════════════════════════════════ */

function initMap() {
  mapInst = L.map('mapEl').setView([31.952, 34.895], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18,
  }).addTo(mapInst);
  updateMap();
}

function updateMap() {
  if (!mapInst) return;

  // Remove old markers
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  const mPM   = document.getElementById('mfPM').value;
  const mSt   = document.getElementById('mfSt').value;
  const mType = document.getElementById('mfType').value;

  // Apply user filter + map-specific filters
  const mapData = _userFilter(ALL_PROJECTS).filter(r => {
    if (mPM   && r.manager      !== mPM)   return false;
    if (mSt   && r.status       !== mSt)   return false;
    if (mType === 'int'   && (r.is_ext || r.is_eiruv)) return false;
    if (mType === 'ext'   && !r.is_ext)    return false;
    if (mType === 'eiruv' && !r.is_eiruv)  return false;
    if (!r.coords || !r.coords[0])         return false;
    return true;
  });

  const hoodCount = {};

  mapData.forEach(r => {
    // Circle size = risk level; colour = type or status
    const color  = r.is_eiruv ? '#0e7490' : r.is_ext ? '#059669' : (STAT_C[r.status] || '#94a3b8');
    const radius = r.risk_score > 5 ? 16 : r.risk_score > 2 ? 12 : 9;

    const circle = L.circleMarker([r.coords[0], r.coords[1]], {
      radius, fillColor: color, color: 'rgba(255,255,255,0.9)', weight: 2.5, opacity: 1, fillOpacity: .82,
    });

    const tooltip = `<div class="pt">
      <div class="pt-title">${esc((r.sub || r.project || '—').substring(0, 50))}</div>
      <div class="pt-row">📍 ${esc(r.neighborhood || r.district || '—')}</div>
      <div class="pt-row">👷 ${esc(r.manager || '—')}</div>
      <div class="pt-row">📌 ${esc(r.status || '—')}</div>
      ${r.is_eiruv ? '<div class="pt-row" style="color:#0e7490;font-weight:600">🏙️ עירוב שימושים</div>' : ''}
      ${r.risk_score > 0 ? `<div class="pt-row">⚠️ ציון סיכון: ${r.risk_score}</div>` : ''}
      ${r.blockers ? `<div class="pt-row" style="max-width:200px">🚧 ${esc(r.blockers.substring(0, 55))}</div>` : ''}
    </div>`;

    circle.bindTooltip(tooltip, { direction: 'top', offset: [0, -5] });
    circle.addTo(mapInst);
    mapMarkers.push(circle);

    const h = r.neighborhood || r.district || 'אחר';
    hoodCount[h] = (hoodCount[h] || 0) + 1;
  });

  // Hood density sidebar
  const sorted = Object.entries(hoodCount).sort((a, b) => b[1] - a[1]);
  document.getElementById('hood-stats').innerHTML = sorted.map(([h, n]) =>
    `<div class="map-stat"><span>${esc(h)}</span><b>${n}</b></div>`
  ).join('');
}

/* ════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════ */

function nav(page) {
  ['dash', 'risk', 'map'].forEach(p => {
    document.getElementById(`page-${p}`).classList.toggle('active', p === page);
    document.getElementById(`nav-${p}`).classList.toggle('active', p === page);
  });
  if (page === 'map'  && !mapInst) initMap();
  if (page === 'risk') _updateRisk(getFiltered());
}

/* ════════════════════════════════════════════════
   MAIN UPDATE
   Called whenever a filter changes or data loads.
════════════════════════════════════════════════ */

function update() {
  const filtered = getFiltered();
  const internal = filtered.filter(r => !r.is_ext && !r.is_eiruv);
  const external = filtered.filter(r =>  r.is_ext);
  const eiruv    = filtered.filter(r =>  r.is_eiruv);

  // ── Topbar ──
  document.getElementById('hbadge').textContent    = `${filtered.length} פרויקטים`;
  document.getElementById('tb-subtitle').textContent =
    `${internal.length} פנימי · ${external.length} גורמי חוץ · ${eiruv.length} עירוב שימושים`;

  // ── KPIs ──
  document.getElementById('kTotal').textContent   = filtered.length;
  document.getElementById('kTotalSub').textContent =
    `${internal.length} פנימי · ${external.length} חיצוני · ${eiruv.length} עירוב`;

  let atRisk = 0, blocked = 0;
  internal.forEach(r => {
    if (r.blockers) blocked++;
    QS26.forEach(q => {
      const st = r.comp[q];
      if (st === 'לא בוצע' || st === 'צפי לאי עמידה') atRisk++;
    });
  });
  document.getElementById('kRisk').textContent    = atRisk;
  document.getElementById('kBlocked').textContent = blocked;

  // ── Charts ──
  _updateDonut1(internal);
  _updateDonut2(internal);
  _updateMgrBars(internal);

  // ── Tables ──
  document.getElementById('cnt-int').textContent   = internal.length;
  document.getElementById('cnt-ext').textContent   = external.length;
  document.getElementById('cnt-eiruv').textContent = eiruv.length;

  const thead = makeThead(false);
  const theadExt = makeThead(true);

  document.getElementById('th-int').innerHTML    = thead;
  document.getElementById('tb-int').innerHTML    = makeRows(internal, stInt,   false, false);
  document.getElementById('th-ext').innerHTML    = theadExt;
  document.getElementById('tb-ext').innerHTML    = makeRows(external, stExt,   true,  false);
  document.getElementById('th-eiruv').innerHTML  = thead;
  document.getElementById('tb-eiruv').innerHTML  = makeRows(eiruv,   stEiruv, false, true);

  // ── Risk page (update if visible) ──
  if (document.getElementById('page-risk').classList.contains('active')) {
    _updateRisk(filtered);
  }

  // ── Map (update if visible) ──
  if (mapInst) updateMap();
}

/* ════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', init);
