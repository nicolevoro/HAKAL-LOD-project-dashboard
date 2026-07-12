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
// (map page state is self-contained in the Maps module below)

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
   MAPS PAGE — Embedded PDF viewer + Project panel

   Layout (two panels):
   Left  : <iframe> showing the official neighbourhood PDF
           (browser's native zoom / scroll / fit-to-width)
   Right : dropdown to select a project + detail card

   Data:
   • NM_HOODS        neighbourhood list (PDF paths + match keys)
   • NM_LOT_DATA     PDF-extracted lot info (developer/units/occupancy/buildings)
   • ALL_PROJECTS    live project data fetched from projects.json

   All logic is wrapped in try/catch; any failure shows a
   graceful message without affecting the rest of the dashboard.
════════════════════════════════════════════════ */

/* ── Neighbourhood definitions ── */
const NM_HOODS = [
  {
    id:    'nofei',
    name:  'נופי בן שמן',
    pdf:   'maps/nofei-ben-shemen.pdf',
    match: 'נופי בן שמן',
  },
  {
    id:    'harofev',
    name:  'הרובע הבינלאומי',
    pdf:   'maps/international-quarter.pdf',
    match: 'הרובע הבינלאומי',
  },
];

/* ── Lot data extracted from official PDF maps ── */
/* developer, units, occupancy quarter, type, public buildings */
const NM_LOT_DATA = {
  // ── נופי בן שמן — public ──
  '100':  { developer:'',             units:144, occupancy:'',        type:'public',      buildings:['מבנה ציבור'] },
  '400':  { developer:'',             units:0,   occupancy:'',        type:'public',      buildings:['מבנה ציבור'] },
  '401':  { developer:'',             units:0,   occupancy:'',        type:'public',      buildings:['4 כיתות גן','בית כנסת'] },
  '402':  { developer:'',             units:0,   occupancy:'',        type:'public',      buildings:['6 כיתות גן'] },
  '403':  { developer:'',             units:0,   occupancy:'',        type:'public',      buildings:['בי"ס יסודי 24 כיתות','אולם ספורט','מסחר','מקווה'] },
  '404':  { developer:'',             units:0,   occupancy:'',        type:'public',      buildings:['בי"ס יסודי 24 כיתות','4 כיתות גן','מסחר','מועדון נוער'] },
  '405':  { developer:'',             units:0,   occupancy:'',        type:'public',      buildings:['6 כיתות גן'] },
  '406':  { developer:'',             units:0,   occupancy:'',        type:'public',      buildings:['בי"ס תיכון 54 כיתות','מעון יום','אולם ספורט','מבנה רב תכליתי'] },
  '407':  { developer:'',             units:0,   occupancy:'',        type:'public',      buildings:['מעונות יום','6 כיתות'] },
  '408':  { developer:'',             units:0,   occupancy:'',        type:'public',      buildings:['בי"ס יסודי 18 כיתות','3 כיתות גן','מגרש ספורט','בית כנסת'] },
  // ── נופי בן שמן — residential ──
  '101':  { developer:'אהרוני',       units:164, occupancy:'Q1/2027', type:'residential', buildings:[] },
  '102':  { developer:'',             units:196, occupancy:'',        type:'residential', buildings:[] },
  '103':  { developer:'אמורה',        units:166, occupancy:'Q3/2028', type:'residential', buildings:[] },
  '104':  { developer:'',             units:102, occupancy:'',        type:'residential', buildings:[] },
  '105':  { developer:'אפי קפיטל',   units:190, occupancy:'Q3/2027', type:'residential', buildings:[] },
  '106':  { developer:'אמורה',        units:166, occupancy:'',        type:'residential', buildings:[] },
  '108':  { developer:'אהרוזדים',     units:402, occupancy:'Q3/2028', type:'residential', buildings:[] },
  '109':  { developer:'שיקון ובינוי', units:247, occupancy:'Q3/2026', type:'residential', buildings:[] },
  '111':  { developer:"פרסקוביץ'",   units:352, occupancy:'',        type:'residential', buildings:[] },
  '113':  { developer:'אמורה',        units:166, occupancy:'',        type:'residential', buildings:[] },
  '114':  { developer:'שיקון וביני',  units:168, occupancy:'',        type:'residential', buildings:[] },
  '115':  { developer:'אהרוני',       units:274, occupancy:'Q1/2028', type:'residential', buildings:[] },
  '117':  { developer:'דוראל',        units:200, occupancy:'Q3/2026', type:'residential', buildings:[] },
  '118':  { developer:'שיקון ביני',   units:166, occupancy:'',        type:'residential', buildings:[] },
  '119':  { developer:'אמורה',        units:168, occupancy:'',        type:'residential', buildings:[] },
  '121':  { developer:'אהרוני',       units:274, occupancy:'Q1/2028', type:'residential', buildings:[] },
  '123':  { developer:'אפי קפיטל',   units:196, occupancy:'Q3/2028', type:'residential', buildings:[] },
  '150':  { developer:'',             units:300, occupancy:'',        type:'residential', buildings:[] },
  '1050': { developer:'עץ השקד',      units:132, occupancy:'Q2/2028', type:'residential', buildings:[] },
  // ── הרובע הבינלאומי ──
  '4002': { developer:'', units:0, occupancy:'', type:'public',      buildings:['בי"ס תיכון 42 כיתות','12 כיתות חינוך מיוחד'] },
  '4004': { developer:'', units:0, occupancy:'', type:'public',      buildings:['מתחם ציבורי'] },
  '4007': { developer:'', units:0, occupancy:'', type:'public',      buildings:['4 כיתות גן','בית כנסת'] },
  '4008': { developer:'', units:0, occupancy:'', type:'public',      buildings:['6 מעונות יום שיקומיים'] },
  '4009': { developer:'', units:0, occupancy:'', type:'public',      buildings:['3 מעונות יום','4 גני ילדים'] },
  '4010': { developer:'', units:0, occupancy:'', type:'public',      buildings:['ריכוז בתי כנסת'] },
  '4011': { developer:'', units:0, occupancy:'', type:'public',      buildings:['בי"ס יסודי 18 כיתות'] },
  '4012': { developer:'', units:0, occupancy:'', type:'public',      buildings:['בי"ס יסודי 24 כיתות','מועדון נוער'] },
  '4014': { developer:'', units:0, occupancy:'', type:'public',      buildings:['24 כיתות בתי ספר יסודיים','מקווה'] },
  '4017': { developer:'', units:0, occupancy:'', type:'public',      buildings:['מבנה ציבורי'] },
  '4021': { developer:'', units:0, occupancy:'', type:'public',      buildings:['3 מעונות יום','4 גני ילדים','בית כנסת'] },
  '4022': { developer:'', units:0, occupancy:'', type:'public',      buildings:['3 כיתות גן','בית כנסת'] },
  '4023': { developer:'', units:0, occupancy:'', type:'public',      buildings:['6 מעונות יום','4 גני ילדים','מועדון נוער'] },
  '4030': { developer:'', units:0, occupancy:'', type:'residential', buildings:[] },
  '905':  { developer:'', units:0, occupancy:'', type:'public',      buildings:['מבנה ציבורי'] },
  '906':  { developer:'', units:0, occupancy:'', type:'public',      buildings:['מבנה ציבורי'] },
  '303':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '304':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '306':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '312':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '313':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '314':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '316':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '323':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '324':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '339':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '341':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
  '342':  { developer:'', units:0, occupancy:'', type:'mixed',       buildings:['עירוב שימושים'] },
};

/* ── Runtime state ── */
let NM_ACTIVE_ID = NM_HOODS[0].id;

/* ═══════════════════════════════════
   PUBLIC API
═══════════════════════════════════ */

/** Called by nav() every time the Maps tab is opened. */
function initNeighbourhoodMap() {
  try {
    _nmBuildTabs();
    nmSelectHood(NM_ACTIVE_ID);
  } catch (e) { console.error('initNeighbourhoodMap:', e); }
}

/** Switch to a different neighbourhood. */
function nmSelectHood(id) {
  try {
    NM_ACTIVE_ID = id;
    const hood = NM_HOODS.find(h => h.id === id) || NM_HOODS[0];

    // Update tab highlight
    document.querySelectorAll('.nm-tab').forEach(b =>
      b.classList.toggle('active', b.textContent === hood.name)
    );

    // Load PDF (async — errors handled inside)
    _nmLoadPdf(hood.pdf);

    // Populate the project dropdown for this neighbourhood
    _nmPopulateSelect(hood.match);

    // Reset the detail panel
    setHTML('nm-proj-detail', '<div class="nm-detail-hint">בחר פרויקט מהרשימה לצפייה בפרטים</div>');
  } catch (e) { console.error('nmSelectHood:', e); }
}

/** Called when the user picks a project in the dropdown. */
function nmShowProject(projectId) {
  try {
    const detailEl = document.getElementById('nm-proj-detail');
    if (!detailEl) return;

    if (!projectId) {
      detailEl.innerHTML = '<div class="nm-detail-hint">בחר פרויקט מהרשימה לצפייה בפרטים</div>';
      return;
    }

    const p = ALL_PROJECTS.find(r => r.id === projectId);
    if (!p) return;

    // Try to find lot data
    const lotKey  = _nmExtractLotKey(p.sub || '') || _nmExtractLotKey(p.project || '');
    const lotInfo = lotKey ? (NM_LOT_DATA[lotKey] || null) : null;

    let html = `<div class="nm-detail-card">`;

    /* ── Lot identifier ── */
    html += `<div class="nm-detail-title">${esc(p.sub || p.project || '—')}</div>`;
    if (lotKey) html += `<div class="nm-detail-lot">מגרש ${esc(lotKey)}</div>`;

    /* ── PDF-extracted data (if available) ── */
    if (lotInfo) {
      html += `<div class="nm-section"><div class="nm-section-title">מידע מהמפה הרשמית</div>`;
      if (lotInfo.developer) html += _nmRow('יזם / קבלן',  lotInfo.developer);
      if (lotInfo.units)     html += _nmRow('יחידות דיור', lotInfo.units + ' יח"ד');
      if (lotInfo.occupancy) html += _nmRow('אכלוס משוער', lotInfo.occupancy);
      const typeLabel = lotInfo.type === 'public' ? 'ציבורי' : lotInfo.type === 'mixed' ? 'עירוב שימושים' : 'מגורים';
      html += _nmRow('סוג מגרש', typeLabel);
      if (lotInfo.buildings && lotInfo.buildings.length) {
        html += `<div class="nm-row"><span class="nm-row-lbl">מבני ציבור</span>
          <div class="nm-tags">${lotInfo.buildings.map(b => `<span class="nm-tag">${esc(b)}</span>`).join('')}</div>
        </div>`;
      }
      html += '</div>';
    }

    /* ── Live project data ── */
    html += `<div class="nm-section"><div class="nm-section-title">נתוני פרויקט</div>`;
    html += _nmRow('פרויקט אב',  p.project);
    html += _nmRow('מנהל',       p.manager);
    if (p.supervisor) html += _nmRow('גורם מבצע', p.supervisor);

    const stHex = _nmStatusHex(p.status);
    html += `<div class="nm-row"><span class="nm-row-lbl">סטטוס</span>
      <span class="nm-status-badge" style="background:${stHex}22;color:${stHex};border:1px solid ${stHex}44">${esc(p.status || '—')}</span>
    </div>`;

    if (p.blockers) {
      html += `<div class="nm-row"><span class="nm-row-lbl">חסמים</span>
        <span class="nm-row-val" style="color:var(--danger)">${esc(p.blockers)}</span></div>`;
    }
    if (p.notes) html += _nmRow('הערות', p.notes);
    html += '</div>';

    /* ── Milestones 2026 ── */
    const msCells = QS26.map(q => {
      const ms = (p.plan || {})[q];
      const st = (p.comp || {})[q];
      const c  = st && COMP[st] ? COMP[st] : null;
      if (!ms || !ms.text.trim()) return '';
      return `<div class="nm-ms-cell"${c ? ` style="border-color:${c.bg}"` : ''}>
        <div class="nm-ms-q">${q.replace(' 2026','')}${st ? ' · ' + st : ''}</div>
        <div class="nm-ms-txt">${esc(ms.text)}${ms.month ? ' [' + esc(ms.month) + ']' : ''}</div>
      </div>`;
    }).filter(Boolean).join('');

    if (msCells) {
      html += `<div class="nm-section"><div class="nm-section-title">אבני דרך 2026</div>
        <div class="nm-ms-grid">${msCells}</div>
      </div>`;
    }

    /* ── Future milestones ── */
    const futureRows = [
      p.yr2027 ? _nmRow('2027', p.yr2027) : '',
      p.yr2028 ? _nmRow('2028', p.yr2028) : '',
      p.yr2029 ? _nmRow('2029', p.yr2029) : '',
    ].filter(Boolean).join('');

    if (futureRows) {
      html += `<div class="nm-section"><div class="nm-section-title">יעדים עתידיים</div>${futureRows}</div>`;
    }

    html += '</div>'; // nm-detail-card
    detailEl.innerHTML = html;
  } catch (e) { console.error('nmShowProject:', e); }
}

/* ═══════════════════════════════════
   PRIVATE HELPERS
═══════════════════════════════════ */

/** Build neighbourhood tab buttons (idempotent). */
function _nmBuildTabs() {
  const tabsEl = document.getElementById('nm-tabs');
  if (!tabsEl || tabsEl.childElementCount > 0) return;
  NM_HOODS.forEach((h, i) => {
    const btn = document.createElement('button');
    btn.className   = 'nm-tab' + (i === 0 ? ' active' : '');
    btn.textContent = h.name;
    btn.onclick     = () => nmSelectHood(h.id);
    tabsEl.appendChild(btn);
  });
}

/** Load PDF into the iframe; show error message if unavailable. */
async function _nmLoadPdf(pdfUrl) {
  const frame  = document.getElementById('nm-pdf-frame');
  const errDiv = document.getElementById('nm-pdf-error');
  if (!frame || !errDiv) return;

  // Reset state while loading
  frame.style.display  = 'none';
  errDiv.style.display = 'none';

  try {
    const res = await fetch(pdfUrl, { method: 'HEAD' });
    if (res.ok) {
      frame.src           = pdfUrl;
      frame.style.display = 'block';
    } else {
      errDiv.style.display = 'flex';
    }
  } catch {
    // On file:// protocol or network error → attempt to show the PDF anyway
    // (fetch fails on file://, but iframe may still work)
    frame.src           = pdfUrl;
    frame.style.display = 'block';
  }
}

/** Fill the project dropdown for the selected neighbourhood. */
function _nmPopulateSelect(matchNeighbourhood) {
  const sel = document.getElementById('nm-proj-select');
  if (!sel) return;

  // Remove old options except the placeholder
  while (sel.options.length > 1) sel.remove(1);

  // Filter by neighbourhood + user role
  const visible  = _userFilter(ALL_PROJECTS);
  const projects = visible
    .filter(p => (p.neighborhood || '') === matchNeighbourhood)
    .sort((a, b) => (a.sub || a.project || '').localeCompare(b.sub || b.project || '', 'he'));

  projects.forEach(p => {
    const o = document.createElement('option');
    o.value       = p.id;
    const label   = p.sub || p.project || '—';
    const lotKey  = _nmExtractLotKey(label);
    o.textContent = lotKey ? `מגרש ${lotKey} — ${esc(p.manager || '')}` : esc(label);
    sel.appendChild(o);
  });

  // Reset detail panel
  set('nm-proj-count', projects.length + ' פרויקטים');
}

/** Extract a lot number string from a project name, e.g. "מגרש 108" → "108". */
function _nmExtractLotKey(s) {
  const m = (s || '').match(/מגרש\s+([\d\+]+)/);
  return m ? m[1] : null;
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
  if (value === null || value === undefined || value === '') return '';
  return `<div class="nm-row">
    <span class="nm-row-lbl">${esc(label)}</span>
    <span class="nm-row-val">${esc(String(value))}</span>
  </div>`;
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
