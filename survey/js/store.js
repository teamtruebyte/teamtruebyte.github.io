/* Offline store — IndexedDB.
 *
 * Field surveys happen where there is often no signal, so everything is written
 * locally FIRST and pushed to Supabase later (the same offline-first design as
 * the mobile app's SyncService). Photos are kept as real Blobs, which is why
 * IndexedDB is used rather than localStorage.
 *
 * Stores
 *   drafts  key = serverSurveyId (the `surveys` row this draft belongs to)
 *           { surveyId, doc, status: 'draft'|'pending'|'synced', updatedAt, syncedAt }
 *   photos  key = auto id, index by surveyId
 *           { surveyId, category, blob, lat, lng, bearingDeg, isSouthFacing,
 *             capturedAt, filename }
 *
 * A "slot" photo (Main Gate / Selfie / SMPS Label) is just a photo whose
 * category is one of the reserved names and of which we keep at most one.
 */
const DB_NAME = 'surveyor-pwa';
const DB_VERSION = 1;

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'surveyId' });
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        s.createIndex('bySurvey', 'surveyId', { unique: false });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}
function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ── drafts ──────────────────────────────────────────────────────────────── */

export async function getDraft(surveyId) {
  return wrap((await tx('drafts', 'readonly')).get(surveyId));
}

export async function putDraft(draft) {
  draft.updatedAt = new Date().toISOString();
  return wrap((await tx('drafts', 'readwrite')).put(draft));
}

export async function allDrafts() {
  return (await wrap((await tx('drafts', 'readonly')).getAll())) || [];
}

export async function deleteDraft(surveyId) {
  await wrap((await tx('drafts', 'readwrite')).delete(surveyId));
  await deletePhotos(surveyId);
}

/** Completed-but-not-yet-uploaded surveys — what the sync retries. */
export async function pendingDrafts() {
  return (await allDrafts()).filter((d) => d.status === 'pending');
}

/* ── photos ──────────────────────────────────────────────────────────────── */

export async function addPhoto(photo) {
  return wrap((await tx('photos', 'readwrite')).add(photo));
}

export async function photosFor(surveyId) {
  const store = await tx('photos', 'readonly');
  const rows = await wrap(store.index('bySurvey').getAll(surveyId));
  return rows || [];
}

export async function deletePhoto(id) {
  return wrap((await tx('photos', 'readwrite')).delete(id));
}

export async function deletePhotos(surveyId) {
  const rows = await photosFor(surveyId);
  const store = await tx('photos', 'readwrite');
  for (const r of rows) store.delete(r.id);
}

/** Replaces the single photo held in a reserved slot category. */
export async function setSlotPhoto(surveyId, category, photo) {
  const existing = (await photosFor(surveyId)).filter((p) => p.category === category);
  for (const e of existing) await deletePhoto(e.id);
  if (photo) await addPhoto({ ...photo, surveyId, category });
}

/**
 * Groups a survey's photos the way the form + submit expect:
 *   { categories: { 'Site Photos': [...] }, mainGatePhoto, selfiePhoto,
 *     smpsLabelPhoto, layout: [...] }
 */
export function groupPhotos(rows) {
  const out = { categories: {}, layout: [], mainGatePhoto: null,
                selfiePhoto: null, smpsLabelPhoto: null };
  for (const r of rows) {
    switch (r.category) {
      case 'Main Gate':       out.mainGatePhoto = r; break;
      case 'Surveyor Selfie': out.selfiePhoto = r; break;
      case 'SMPS Label':      out.smpsLabelPhoto = r; break;
      case 'Layout':          out.layout.push(r); break;
      default:
        (out.categories[r.category] ||= []).push(r);
    }
  }
  return out;
}

/** Rough size of everything stored, for the "storage used" hint. */
export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usage, quota };
}
