/* Supabase access layer.
 *
 * submitSurvey() is a direct port of SurveySubmitService.submit() in
 * mobile/lib/services/survey_submit_service.dart — same order, same tables,
 * same idempotent retry behaviour (photo rows are deleted then reinserted and
 * uploads use upsert, so re-submitting overwrites rather than duplicates).
 * Keep the two in step.
 *
 * RLS does the authorisation: a surveyor only ever sees/writes their own
 * surveys (0002_rls_policies.sql) and may only write storage objects under
 * survey-photos/<their survey id>/ (0003_storage_policies.sql).
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, PHOTO_BUCKET, slug,
         CAT_MAIN_GATE, CAT_SMPS_LABEL, CAT_SELFIE, CAT_LAYOUT } from './config.js';

// vendor/supabase.js is a UMD bundle loaded by a plain <script> before this module.
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ── auth ────────────────────────────────────────────────────────────────── */

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  // portal.greenintel.in/** is already on the Supabase redirect allowlist, so
  // returning to this exact page works with no extra configuration.
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() { await sb.auth.signOut(); }

export async function currentSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

/** The signed-in user's profile row, or null if they were never invited. */
export async function fetchProfile() {
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return null;
  const { data, error } = await sb
    .from('profiles')
    .select('id, email, full_name, role, org_id, is_active')
    .eq('id', u.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ── assignments ─────────────────────────────────────────────────────────── */

const ASSIGNMENT_COLS =
  'id, status, scheduled_date, route_day, route_seq, not_done_reason, ' +
  'site:sites!inner(id, site_code, name, address, cluster, lat, lng)';

/** Active work (scheduled + in progress), earliest first. */
export async function fetchActive() {
  const { data, error } = await sb
    .from('surveys').select(ASSIGNMENT_COLS)
    .in('status', ['scheduled', 'in_progress'])
    .order('scheduled_date', { ascending: true })
    .order('route_seq', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Everything with a date, for the day-grouped Schedule view. */
export async function fetchSchedule() {
  const { data, error } = await sb
    .from('surveys').select(ASSIGNMENT_COLS)
    .not('scheduled_date', 'is', null)
    .order('scheduled_date', { ascending: true })
    .order('route_seq', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Only flips rows still `scheduled`, so reopening won't reset started_at. */
export async function markInProgress(surveyId) {
  const { error } = await sb.from('surveys')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', surveyId).eq('status', 'scheduled');
  if (error) throw error;
}

export async function markNotDone(surveyId, reason) {
  const { error } = await sb.from('surveys')
    .update({ status: 'not_done', not_done_reason: reason.trim() })
    .eq('id', surveyId);
  if (error) throw error;
}

/* ── submit ──────────────────────────────────────────────────────────────── */

/** PhotoItem JSON exactly as the mobile model serialises it. */
function photoJson(p, storagePath) {
  return {
    path: storagePath,
    watermarked: true,
    latitude: p.lat,
    longitude: p.lng,
    capturedAt: p.capturedAt,
    bearingDeg: p.bearingDeg,
    isSouthFacing: !!p.isSouthFacing,
  };
}

/**
 * Pushes a completed survey. Throws on failure so the caller can leave it
 * queued and retry later (offline-first). Safe to call repeatedly.
 *
 * @param surveyId server `surveys` row id
 * @param doc      the plain form object (see schema.blankSurvey)
 * @param photos   rows from the IndexedDB photos store for this survey
 */
export async function submitSurvey(surveyId, doc, photos) {
  // 1. org_id — survey_data and photos both require it, and RLS checks it.
  const { data: row, error: e1 } = await sb
    .from('surveys').select('org_id').eq('id', surveyId).single();
  if (e1) throw e1;
  const orgId = row.org_id;

  // 2. Upload every photo first, so the form JSON can carry real storage paths.
  const uploaded = [];
  for (const p of photos) {
    const path = `${surveyId}/${slug(p.category)}/${p.filename}`;
    const { error } = await sb.storage.from(PHOTO_BUCKET)
      .upload(path, p.blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
    uploaded.push({ ...p, storagePath: path });
  }

  // 3. Rebuild the Survey-shaped form document (same keys as Survey.toJson()).
  const form = { ...doc };
  form.id = crypto.randomUUID();
  form.serverSurveyId = surveyId;
  form.status = 'completed';
  form.createdAt = doc.createdAt || new Date().toISOString();
  form.updatedAt = new Date().toISOString();
  form.syncedAt = new Date().toISOString();
  form.photos = {};
  form.layoutImages = [];
  form.selfiePhoto = null;
  form.mainGatePhoto = null;
  form.smpsLabelPhoto = null;
  for (const p of uploaded) {
    const j = photoJson(p, p.storagePath);
    if (p.category === CAT_MAIN_GATE) form.mainGatePhoto = j;
    else if (p.category === CAT_SELFIE) form.selfiePhoto = j;
    else if (p.category === CAT_SMPS_LABEL) form.smpsLabelPhoto = j;
    else if (p.category === CAT_LAYOUT) form.layoutImages.push(j);
    else (form.photos[p.category] ||= []).push(j);
  }

  const { error: e2 } = await sb.from('survey_data').upsert({
    survey_id: surveyId,
    org_id: orgId,
    form,
    feasibility: doc.feasibility?.trim() || null,
  });
  if (e2) throw e2;

  // 4. Replace the photo rows (idempotent retry), then insert fresh ones.
  const { error: e3 } = await sb.from('photos').delete().eq('survey_id', surveyId);
  if (e3) throw e3;
  if (uploaded.length) {
    const rows = uploaded.map((p) => ({
      survey_id: surveyId,
      org_id: orgId,
      category: p.category,
      storage_path: p.storagePath,
      lat: p.lat,
      lng: p.lng,
      bearing_deg: p.bearingDeg,
      is_south_facing: !!p.isSouthFacing,
      taken_at: p.capturedAt,
    }));
    const { error } = await sb.from('photos').insert(rows);
    if (error) throw error;
  }

  // 5. Mark the assignment complete.
  const { error: e4 } = await sb.from('surveys')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', surveyId);
  if (e4) throw e4;

  return true;
}
