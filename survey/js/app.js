/* Surveyor PWA — screens and flow.
 *
 * Mirrors the mobile surveyor app: sign in -> "Assigned to me" -> Locate or
 * "I have reached" -> 10-step wizard -> submit. Everything is written to
 * IndexedDB first and pushed to Supabase after, so a survey can be completed
 * with no signal and uploads itself when back online.
 */
import * as api from './api.js';
import * as store from './store.js';
import { STEPS, TABLE_DEFS, blankSurvey, validateForSubmit } from './schema.js';
import { capturePhoto, currentPosition } from './capture.js';
import { PHOTO_CATEGORIES, SITE_CATEGORY, NOT_DONE_REASONS,
         CAT_MAIN_GATE, CAT_SELFIE, CAT_SMPS_LABEL, CAT_LAYOUT,
         compassLabel } from './config.js';

const app = document.getElementById('app');
const S = {
  profile: null, screen: 'loading', assignments: [], schedule: [],
  assignment: null, draft: null, photos: [], step: 0, pending: 0, busy: false,
};
const urls = new Map();   // blob -> object URL, revoked on screen change

/* ── helpers ─────────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 3200);
}

function blobUrl(blob) {
  if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob));
  return urls.get(blob);
}
function clearUrls() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

const STATUS_LABEL = {
  scheduled: 'Scheduled', in_progress: 'In progress',
  completed: 'Completed', not_done: 'Not done',
};

function confirmDialog(title, body, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'sheet-wrap';
    d.innerHTML = `<div class="sheet">
      <h3>${esc(title)}</h3><p>${esc(body)}</p>
      <div class="row">
        <button class="btn ghost" data-no>Cancel</button>
        <button class="btn" data-yes>${esc(okLabel)}</button>
      </div></div>`;
    d.addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-yes')) { d.remove(); resolve(true); }
      else if (e.target.hasAttribute('data-no') || e.target === d) { d.remove(); resolve(false); }
    });
    document.body.appendChild(d);
  });
}

/* ── boot ────────────────────────────────────────────────────────────────── */

async function boot() {
  render();
  const session = await api.currentSession();
  if (!session) { S.screen = 'login'; return render(); }
  await loadProfile();
}

async function loadProfile() {
  try {
    S.profile = await api.fetchProfile();
  } catch {
    S.screen = 'login';
    return render();
  }
  if (!S.profile) { S.screen = 'no-account'; return render(); }
  if (S.profile.is_active === false) { S.screen = 'deactivated'; return render(); }
  if (S.profile.role !== 'surveyor') { S.screen = 'wrong-role'; return render(); }
  S.screen = 'home';
  render();
  refreshHome();
  syncPending();
}

api.sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' && S.screen === 'login') loadProfile();
  if (event === 'SIGNED_OUT') { S.profile = null; S.screen = 'login'; render(); }
});

/* ── sync ────────────────────────────────────────────────────────────────── */

/** Retries every completed-but-unsent survey. Safe to call often. */
async function syncPending() {
  const pending = await store.pendingDrafts();
  S.pending = pending.length;
  renderPendingBanner();
  if (!pending.length || !navigator.onLine) return;

  let sent = 0;
  for (const d of pending) {
    try {
      const photos = await store.photosFor(d.surveyId);
      await api.submitSurvey(d.surveyId, d.doc, photos);
      d.status = 'synced';
      d.syncedAt = new Date().toISOString();
      await store.putDraft(d);
      await store.deletePhotos(d.surveyId);   // blobs are on the server now
      sent++;
    } catch { /* stay pending, try again later */ }
  }
  if (sent) {
    toast(`${sent} survey${sent > 1 ? 's' : ''} uploaded`, 'ok');
    refreshHome();
  }
  S.pending = (await store.pendingDrafts()).length;
  renderPendingBanner();
}

window.addEventListener('online', syncPending);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.profile) { syncPending(); refreshHome(); }
});

/* ── data loads ──────────────────────────────────────────────────────────── */

async function refreshHome() {
  if (!S.profile) return;
  try {
    S.assignments = await api.fetchActive();
    if (S.screen === 'home') render();
  } catch {
    if (S.screen === 'home') renderOfflineNote();
  }
}

async function refreshSchedule() {
  try {
    S.schedule = await api.fetchSchedule();
    if (S.screen === 'schedule') render();
  } catch { toast('Could not load the schedule — check your connection.', 'err'); }
}

/* ── render ──────────────────────────────────────────────────────────────── */

function render() {
  clearUrls();
  switch (S.screen) {
    case 'loading':     app.innerHTML = `<div class="center"><div class="spinner"></div></div>`; break;
    case 'login':       renderLogin(); break;
    case 'no-account':  renderNotice('No account set up',
                          'Your email is not on the invite list yet. Ask the Ops team to invite you, then sign in again.'); break;
    case 'deactivated': renderNotice('Account deactivated',
                          'Your account has been deactivated. Please contact the Ops team.'); break;
    case 'wrong-role':  renderNotice('Use the web portal',
                          'This app is for field surveyors. Your account is an Ops/Client account — open portal.greenintel.in instead.'); break;
    case 'home':        renderHome(); break;
    case 'schedule':    renderSchedule(); break;
    case 'wizard':      renderWizard(); break;
  }
}

function renderLogin() {
  app.innerHTML = `
    <div class="auth">
      <div class="brand"><span class="logo">◐</span><h1>Solar Survey</h1>
        <p>Field surveyor app</p></div>
      <form id="loginForm" class="card">
        <label>Email<input type="email" name="email" required autocomplete="username"></label>
        <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn" type="submit">Sign in</button>
        <div class="or"><span>or</span></div>
        <button class="btn ghost" type="button" id="googleBtn">Continue with Google</button>
        <p class="err" id="loginErr"></p>
      </form>
    </div>`;
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = document.getElementById('loginErr');
    err.textContent = '';
    try {
      e.target.querySelector('button').disabled = true;
      await api.signIn(f.get('email').trim(), f.get('password'));
      await loadProfile();
    } catch (ex) {
      err.textContent = ex.message || 'Could not sign in.';
      e.target.querySelector('button').disabled = false;
    }
  });
  document.getElementById('googleBtn').addEventListener('click', async () => {
    try { await api.signInWithGoogle(); }
    catch (ex) { document.getElementById('loginErr').textContent = ex.message; }
  });
}

function renderNotice(title, body) {
  app.innerHTML = `<div class="auth"><div class="card">
    <h2>${esc(title)}</h2><p>${esc(body)}</p>
    <button class="btn ghost" id="outBtn">Sign out</button></div></div>`;
  document.getElementById('outBtn').addEventListener('click', () => api.signOut());
}

function header(title, opts = {}) {
  return `<header class="top">
    ${opts.back ? `<button class="icon" id="backBtn" aria-label="Back">‹</button>` : ''}
    <div><h1>${esc(title)}</h1>${opts.sub ? `<p>${esc(opts.sub)}</p>` : ''}</div>
    ${opts.action || ''}
  </header>`;
}

function renderHome() {
  const rows = S.assignments.map((a) => {
    const s = a.site || {};
    return `<button class="card tap" data-id="${a.id}">
      <div class="row between">
        <strong>${esc(s.name || 'Site')}</strong>
        <span class="chip ${a.status}">${STATUS_LABEL[a.status] || a.status}</span>
      </div>
      <p class="mut">${esc(s.site_code || '')}${s.address ? ' · ' + esc(s.address) : ''}</p>
      ${a.scheduled_date ? `<p class="mut sm">Scheduled ${esc(a.scheduled_date)}</p>` : ''}
    </button>`;
  }).join('');

  app.innerHTML = `
    ${header('Assigned to me', { sub: S.profile?.full_name || S.profile?.email,
      action: `<button class="icon" id="menuBtn" aria-label="Menu">⋮</button>` })}
    <div id="pendingBanner"></div>
    <main class="wrap">
      <div class="tabs">
        <button class="tab on">Assigned</button>
        <button class="tab" id="schedTab">Schedule</button>
      </div>
      ${rows || `<div class="empty"><p>No surveys assigned right now.</p>
        <p class="mut sm">Pull down or tap refresh once Ops assigns you a site.</p></div>`}
      <button class="btn ghost" id="refreshBtn">Refresh</button>
    </main>`;

  renderPendingBanner();
  document.getElementById('refreshBtn').addEventListener('click', () => { refreshHome(); syncPending(); });
  document.getElementById('schedTab').addEventListener('click', () => {
    S.screen = 'schedule'; render(); refreshSchedule();
  });
  document.getElementById('menuBtn').addEventListener('click', async () => {
    if (await confirmDialog('Sign out?', 'Any unsent surveys stay saved on this phone.', 'Sign out')) {
      api.signOut();
    }
  });
  app.querySelectorAll('.card.tap').forEach((c) => {
    c.addEventListener('click', () => openAssignmentSheet(c.dataset.id));
  });
}

function renderPendingBanner() {
  const el = document.getElementById('pendingBanner');
  if (!el) return;
  el.innerHTML = S.pending
    ? `<div class="banner">${S.pending} survey${S.pending > 1 ? 's' : ''} waiting to upload
         <button class="link" id="syncNow">Sync now</button></div>`
    : '';
  document.getElementById('syncNow')?.addEventListener('click', syncPending);
}

function renderOfflineNote() {
  const el = document.getElementById('pendingBanner');
  if (el && !S.pending) el.innerHTML = `<div class="banner warn">Offline — showing saved work.</div>`;
}

function renderSchedule() {
  const byDate = {};
  for (const a of S.schedule) (byDate[a.scheduled_date] ||= []).push(a);
  const days = Object.keys(byDate).sort();
  const body = days.map((d, i) => `
    <h3 class="day">Day ${i + 1} · ${esc(d)}</h3>
    ${byDate[d].map((a) => {
      const s = a.site || {};
      return `<button class="card tap" data-id="${a.id}">
        <div class="row between"><strong>${esc(s.name || 'Site')}</strong>
          <span class="chip ${a.status}">${STATUS_LABEL[a.status] || a.status}</span></div>
        <p class="mut">${esc(s.site_code || '')}</p>
        ${a.not_done_reason ? `<p class="mut sm">Reason: ${esc(a.not_done_reason)}</p>` : ''}
      </button>`;
    }).join('')}`).join('');

  app.innerHTML = `
    ${header('Schedule', { back: true })}
    <main class="wrap">${body || `<div class="empty"><p>Nothing scheduled yet.</p></div>`}</main>`;
  document.getElementById('backBtn').addEventListener('click', () => { S.screen = 'home'; render(); });
  app.querySelectorAll('.card.tap').forEach((c) => {
    c.addEventListener('click', () => openAssignmentSheet(c.dataset.id));
  });
}

/* ── assignment actions ──────────────────────────────────────────────────── */

function openAssignmentSheet(id) {
  const a = [...S.assignments, ...S.schedule].find((x) => x.id === id);
  if (!a) return;
  const s = a.site || {};
  const done = a.status === 'completed';
  const d = document.createElement('div');
  d.className = 'sheet-wrap';
  d.innerHTML = `<div class="sheet">
    <h3>${esc(s.name || 'Site')}</h3>
    <p class="mut">${esc(s.site_code || '')}${s.address ? ' · ' + esc(s.address) : ''}</p>
    <button class="btn ghost" data-act="locate">Locate (open in Maps)</button>
    ${done ? '' : `<button class="btn" data-act="start">I have reached</button>
    <button class="btn ghost danger" data-act="notdone">Mark as Not Done</button>`}
    <button class="btn ghost" data-act="close">Cancel</button></div>`;
  d.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act;
    if (!act && e.target !== d) return;
    if (act === 'locate') {
      d.remove();
      if (s.lat != null && s.lng != null) {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, '_blank');
      } else toast('This site has no coordinates.', 'err');
    } else if (act === 'start') { d.remove(); startSurvey(a); }
    else if (act === 'notdone') { d.remove(); openNotDone(a); }
    else { d.remove(); }
  });
  document.body.appendChild(d);
}

function openNotDone(a) {
  const d = document.createElement('div');
  d.className = 'sheet-wrap';
  d.innerHTML = `<div class="sheet">
    <h3>Mark as Not Done</h3>
    <p class="mut">Ops will reschedule this site.</p>
    <div class="chips">${NOT_DONE_REASONS.map((r) =>
      `<button class="pick" type="button">${esc(r)}</button>`).join('')}</div>
    <label>Reason<textarea id="ndText" rows="3" placeholder="Add details…"></textarea></label>
    <div class="row"><button class="btn ghost" data-no>Cancel</button>
      <button class="btn danger" id="ndOk">Confirm</button></div></div>`;
  const ta = d.querySelector('#ndText');
  d.querySelectorAll('.pick').forEach((b) =>
    b.addEventListener('click', () => { ta.value = b.textContent; ta.focus(); }));
  d.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-no') || e.target === d) d.remove();
  });
  d.querySelector('#ndOk').addEventListener('click', async () => {
    const reason = ta.value.trim();
    if (!reason) return toast('Please give a reason.', 'err');
    try {
      await api.markNotDone(a.id, reason);
      d.remove();
      toast('Marked Not Done. Ops will reschedule.', 'ok');
      refreshHome();
    } catch { toast('Could not save — this needs a connection.', 'err'); }
  });
  document.body.appendChild(d);
}

/* ── wizard ──────────────────────────────────────────────────────────────── */

async function startSurvey(a) {
  const s = a.site || {};
  let draft = await store.getDraft(a.id);
  if (!draft) {
    // Prefill from the site, exactly like the mobile app does.
    const doc = blankSurvey();
    doc.siteId = s.site_code || '';
    doc.siteName = s.name || '';
    doc.siteAddress = s.address || '';
    doc.latitude = s.lat != null ? String(s.lat) : '';
    doc.longitude = s.lng != null ? String(s.lng) : '';
    doc.surveyDate = new Date().toISOString().slice(0, 10);
    doc.engineerName = S.profile?.full_name || '';
    doc.createdAt = new Date().toISOString();
    draft = { surveyId: a.id, doc, status: 'draft' };
    await store.putDraft(draft);
  }
  try { await api.markInProgress(a.id); } catch { /* offline is fine */ }

  S.assignment = a;
  S.draft = draft;
  S.photos = await store.photosFor(a.id);
  S.step = 0;
  S.screen = 'wizard';
  render();
}

async function saveDraft() {
  if (S.draft) await store.putDraft(S.draft);
}

async function reloadPhotos() {
  S.photos = await store.photosFor(S.draft.surveyId);
}

function renderWizard() {
  const step = STEPS[S.step];
  const doc = S.draft.doc;
  const grouped = store.groupPhotos(S.photos);

  let body = '';
  if (step.type === 'fields')      body = fieldsStep(step, doc, grouped);
  else if (step.type === 'table')  body = tableStep(step, doc);
  else if (step.type === 'load')   body = loadStep(step, doc);
  else if (step.type === 'photos') body = photosStep(step, grouped);
  else if (step.type === 'layout') body = layoutStep(grouped);

  const last = S.step === STEPS.length - 1;
  app.innerHTML = `
    ${header(step.title, { back: true, sub: `Step ${S.step + 1} of ${STEPS.length} · ${S.draft.doc.siteName || ''}` })}
    <div class="progress"><div style="width:${((S.step + 1) / STEPS.length) * 100}%"></div></div>
    <main class="wrap">${body}</main>
    <footer class="nav">
      <button class="btn ghost" id="prevBtn" ${S.step === 0 ? 'disabled' : ''}>Back</button>
      ${last ? `<button class="btn" id="submitBtn">Submit survey</button>`
             : `<button class="btn" id="nextBtn">Next</button>`}
    </footer>`;

  document.getElementById('backBtn').addEventListener('click', async () => {
    await saveDraft();
    S.screen = 'home'; render(); refreshHome();
  });
  document.getElementById('prevBtn')?.addEventListener('click', async () => {
    await saveDraft(); S.step--; render();
  });
  document.getElementById('nextBtn')?.addEventListener('click', async () => {
    await saveDraft(); S.step++; render();
  });
  document.getElementById('submitBtn')?.addEventListener('click', submitCurrent);

  wireInputs(doc);
  wirePhotoButtons();
}

/** Binds every input/select/textarea back into the draft document.
 *  Plain fields carry data-key; dynamic table cells carry data-table/row/col. */
function wireInputs(doc) {
  app.querySelectorAll('[data-key], [data-table]').forEach((input) => {
    const onEdit = () => {
      const { key, row, col, table } = input.dataset;
      if (table != null) doc[table][+row][col] = input.value;
      else doc[key] = input.value;
      S.draft.status = 'draft';
      clearTimeout(wireInputs._t);
      wireInputs._t = setTimeout(saveDraft, 400);
    };
    input.addEventListener('input', onEdit);
    input.addEventListener('change', onEdit);   // selects on older browsers
  });
}

function fieldRow(f, doc) {
  const v = esc(doc[f.key] ?? '');
  const req = f.required ? '<span class="req">*</span>' : '';
  if (f.type === 'textarea') {
    return `<label>${esc(f.label)}${req}<textarea data-key="${f.key}" rows="3">${v}</textarea></label>`;
  }
  if (f.type === 'select') {
    return `<label>${esc(f.label)}${req}<select data-key="${f.key}">
      <option value="">Select…</option>
      ${f.options.map((o) => `<option ${doc[f.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    </select></label>`;
  }
  const type = f.type === 'number' ? 'text' : (f.type || 'text');
  const mode = f.type === 'number' ? ' inputmode="decimal"' : (f.type === 'tel' ? ' inputmode="tel"' : '');
  return `<label>${esc(f.label)}${req}<input type="${type}"${mode} data-key="${f.key}" value="${v}"></label>`;
}

function slotCard(slot, photo) {
  const has = !!photo;
  return `<div class="slot ${has ? 'has' : ''}">
    <div class="row between">
      <strong>${esc(slot.label)}${slot.required ? '<span class="req">*</span>' : ''}</strong>
      ${has ? `<button class="link danger" data-del-slot="${slot.key}">Remove</button>` : ''}
    </div>
    ${slot.hint ? `<p class="mut sm">${esc(slot.hint)}</p>` : ''}
    ${has ? `<img src="${blobUrl(photo.blob)}" alt="">
             <p class="mut sm">${photo.bearingDeg != null
                ? `Facing ${Math.round(photo.bearingDeg)}° ${compassLabel(photo.bearingDeg)}` : 'No heading'}</p>`
          : ''}
    <button class="btn ghost" data-shot="${slot.key}" data-selfie="${!!slot.selfie}"
      data-title="${esc(slot.label)}">${has ? 'Retake' : 'Take photo'}</button>
  </div>`;
}

function fieldsStep(step, doc, grouped) {
  const slots = (step.slots || []).map((s) => slotCard(s, grouped[s.key])).join('');
  const gps = step.gps
    ? `<button class="btn ghost" id="gpsBtn">Use my GPS for latitude / longitude</button>`
    : '';
  const solar = step.solarFill
    ? `<button class="btn ghost" id="solarBtn">Auto-fill from NASA (wind, insolation, temperature)</button>
       <p class="mut sm">Uses the latitude / longitude above. Needs a connection — you can
       always type the values in by hand.</p>`
    : '';
  return `${slots}<div class="card">${step.fields.map((f) => fieldRow(f, doc)).join('')}${gps}${solar}</div>`;
}

function tableStep(step, doc) {
  const cols = TABLE_DEFS[step.tableKey];
  const rows = doc[step.tableKey] || [];
  const body = rows.map((r, i) => `
    <div class="card">
      <div class="row between"><strong>#${i + 1}</strong>
        <button class="link danger" data-delrow="${i}">Remove</button></div>
      ${cols.map((c) => {
        const label = c.dynamicLabel ? c.dynamicLabel(r) : c.label;
        const v = esc(r[c.key] ?? '');
        if (c.options) {
          return `<label>${esc(label)}<select data-table="${step.tableKey}" data-row="${i}" data-col="${c.key}">
            <option value="">Select…</option>
            ${c.options.map((o) => `<option ${r[c.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select></label>`;
        }
        return `<label>${esc(label)}<input type="text"${c.numeric ? ' inputmode="decimal"' : ''}
          data-table="${step.tableKey}" data-row="${i}" data-col="${c.key}" value="${v}"></label>`;
      }).join('')}
    </div>`).join('');
  return `${body || `<div class="empty"><p>No entries yet.</p></div>`}
    <button class="btn ghost" id="addRow">+ Add ${esc(step.title)}</button>`;
}

function loadStep(step, doc) {
  return step.groups.map((g) => `<div class="card"><h3>${esc(g.title)}</h3>
    <label>Load Type<input type="text" data-key="${g.keys.loadType}" value="${esc(doc[g.keys.loadType])}"></label>
    <label>Voltage<input type="text" inputmode="decimal" data-key="${g.keys.voltage}" value="${esc(doc[g.keys.voltage])}"></label>
    <label>Current (Amp)<input type="text" inputmode="decimal" data-key="${g.keys.current}" value="${esc(doc[g.keys.current])}"></label>
  </div>`).join('');
}

function photoGrid(list) {
  return `<div class="grid">${list.map((p) => `<div class="thumb">
    <img src="${blobUrl(p.blob)}" alt="">
    ${p.isSouthFacing ? `<span class="s-badge">S</span>` : ''}
    <button class="x" data-del="${p.id}" aria-label="Delete">✕</button>
  </div>`).join('')}</div>`;
}

function photosStep(step, grouped) {
  const cats = PHOTO_CATEGORIES.map((cat) => {
    const list = grouped.categories[cat] || [];
    const isSite = cat === SITE_CATEGORY;
    const hasSouth = list.some((p) => p.isSouthFacing);
    return `<div class="card">
      <div class="row between"><strong>${esc(cat)}${isSite ? '<span class="req">*</span>' : ''}</strong>
        <span class="mut sm">${list.length}</span></div>
      ${isSite ? `<p class="hintbar ${hasSouth ? 'ok' : ''}">${hasSouth
          ? 'South-facing photo added ✓'
          : 'At least one south-facing (S) photo is required here.'}</p>` : ''}
      ${list.length ? photoGrid(list) : ''}
      <button class="btn ghost" data-shot-cat="${esc(cat)}" data-south="${isSite}">Take photo</button>
    </div>`;
  }).join('');
  const slots = (step.slots || []).map((s) => slotCard(s, grouped[s.key])).join('');
  return cats + slots;
}

function layoutStep(grouped) {
  return `<div class="card">
    <div class="row between"><strong>Layout images</strong>
      <span class="mut sm">${grouped.layout.length}</span></div>
    <p class="mut sm">Site / module layout sketches.</p>
    ${grouped.layout.length ? photoGrid(grouped.layout) : ''}
    <button class="btn ghost" data-shot-cat="${CAT_LAYOUT}" data-south="false">Take photo</button>
  </div>`;
}

/* ── wizard interactions ─────────────────────────────────────────────────── */

function wirePhotoButtons() {
  const id = S.draft.surveyId;

  app.querySelectorAll('[data-shot]').forEach((b) => b.addEventListener('click', async () => {
    const cat = { mainGatePhoto: CAT_MAIN_GATE, selfiePhoto: CAT_SELFIE,
                  smpsLabelPhoto: CAT_SMPS_LABEL }[b.dataset.shot];
    const photo = await capturePhoto({
      title: b.dataset.title, selfie: b.dataset.selfie === 'true',
    });
    if (!photo) return;
    await store.setSlotPhoto(id, cat, photo);
    await reloadPhotos(); render();
  }));

  app.querySelectorAll('[data-del-slot]').forEach((b) => b.addEventListener('click', async () => {
    const cat = { mainGatePhoto: CAT_MAIN_GATE, selfiePhoto: CAT_SELFIE,
                  smpsLabelPhoto: CAT_SMPS_LABEL }[b.dataset.delSlot];
    await store.setSlotPhoto(id, cat, null);
    await reloadPhotos(); render();
  }));

  app.querySelectorAll('[data-shot-cat]').forEach((b) => b.addEventListener('click', async () => {
    const cat = b.dataset.shotCat;
    const photo = await capturePhoto({ title: cat, requireSouth: b.dataset.south === 'true' });
    if (!photo) return;
    await store.addPhoto({ ...photo, surveyId: id, category: cat });
    await reloadPhotos(); render();
  }));

  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await store.deletePhoto(+b.dataset.del);
    await reloadPhotos(); render();
  }));

  document.getElementById('addRow')?.addEventListener('click', async () => {
    const key = STEPS[S.step].tableKey;
    (S.draft.doc[key] ||= []).push({});
    await saveDraft(); render();
  });

  app.querySelectorAll('[data-delrow]').forEach((b) => b.addEventListener('click', async () => {
    S.draft.doc[STEPS[S.step].tableKey].splice(+b.dataset.delrow, 1);
    await saveDraft(); render();
  }));

  /* Best-effort NASA POWER auto-fill — mirrors _autofillSolar() in the mobile
   * wizard, including which fields it writes and how they're rounded. Day
   * Length / Tilt / Power Production are deliberately NOT filled (removed from
   * the report per client request in Phase 3.7). */
  document.getElementById('solarBtn')?.addEventListener('click', async (e) => {
    const lat = parseFloat(S.draft.doc.latitude);
    const lon = parseFloat(S.draft.doc.longitude);
    if (isNaN(lat) || isNaN(lon)) {
      return toast('Set the latitude & longitude first (GPS or manual).', 'err');
    }
    const label = e.target.textContent;
    e.target.disabled = true;
    e.target.textContent = 'Fetching from NASA…';
    try {
      const r = await api.fetchSolar(lat, lon);
      const d = S.draft.doc;
      d.temperatureAvg = Number(r.tempAvg).toFixed(1);
      d.temperatureMax = Number(r.tempMax).toFixed(1);
      d.temperatureMin = Number(r.tempMin).toFixed(1);
      d.insolationAnnual = String(Math.round(Number(r.insolationAnnual)));
      d.windSpeed = Number(r.windAvg).toFixed(1);
      await saveDraft();
      render();
      toast('Solar data filled from NASA POWER. Edit if needed.', 'ok');
    } catch {
      e.target.disabled = false;
      e.target.textContent = label;
      toast("Couldn't fetch solar data — enter the values manually.", 'err');
    }
  });

  document.getElementById('gpsBtn')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Getting GPS…';
    try {
      const p = await currentPosition();
      S.draft.doc.latitude = String(p.lat);
      S.draft.doc.longitude = String(p.lng);
      S.draft.doc.gpsAccuracy = String(p.acc);
      await saveDraft(); render();
      toast(`GPS locked (±${p.acc} m)`, 'ok');
    } catch {
      e.target.disabled = false;
      e.target.textContent = 'Use my GPS for latitude / longitude';
      toast('Could not get GPS. Check location permission.', 'err');
    }
  });
}

async function submitCurrent() {
  if (S.busy) return;
  const grouped = store.groupPhotos(S.photos);
  const bad = validateForSubmit(S.draft.doc, grouped);
  if (bad) {
    const i = STEPS.findIndex((s) => s.id === bad.step);
    if (i >= 0) { S.step = i; render(); }
    return toast(bad.msg, 'err');
  }
  // South-facing is prompted, not hard-blocked — same as the mobile app.
  const site = grouped.categories[SITE_CATEGORY] || [];
  if (!site.some((p) => p.isSouthFacing)) {
    const go = await confirmDialog('No south-facing Site Photo',
      'The client requires a photo facing south (180° ± 45°). Submit anyway?', 'Submit anyway');
    if (!go) { S.step = STEPS.findIndex((s) => s.id === 'photos'); return render(); }
  }

  S.busy = true;
  const btn = document.getElementById('submitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  S.draft.status = 'pending';
  await saveDraft();

  try {
    await api.submitSurvey(S.draft.surveyId, S.draft.doc, S.photos);
    S.draft.status = 'synced';
    S.draft.syncedAt = new Date().toISOString();
    await store.putDraft(S.draft);
    await store.deletePhotos(S.draft.surveyId);
    toast('Survey submitted ✓', 'ok');
  } catch {
    // Stays queued; syncPending() retries on reconnect.
    toast('Saved on this phone — it will upload when you have signal.', 'warn');
  }
  S.busy = false;
  S.pending = (await store.pendingDrafts()).length;
  S.screen = 'home';
  render();
  refreshHome();
}

boot();
