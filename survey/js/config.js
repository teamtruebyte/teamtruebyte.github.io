/* Surveyor PWA — connection details + shared rules.
 *
 * PUBLIC values only, exactly as in mobile/lib/config/supabase_config.dart and
 * web/lib/config/supabase_config.dart. All real access is gated by the RLS
 * policies in supabase/migrations/0002_rls_policies.sql (+ 0003 for storage),
 * so shipping these in a static page is safe. Secrets never live here.
 */
export const SUPABASE_URL = 'https://ecfhsblokbvnxundolhp.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_LQqbA0ubguizU4wTvZojSw_41sKussA';

/** Private bucket the mobile app uploads to. Path: <surveyId>/<category_slug>/<file> */
export const PHOTO_BUCKET = 'survey-photos';

/* South-facing rule — must stay identical to Compass in
 * mobile/lib/utils/constants.dart (180° ± 45°). */
export const SOUTH_DEG = 180;
export const SOUTH_TOLERANCE = 45;
export const isSouth = (deg) =>
  deg != null && Math.abs(((deg % 360) + 360) % 360 - SOUTH_DEG) <= SOUTH_TOLERANCE;

const DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
/** 16-point label, e.g. 182 -> "S". Mirrors Compass.label(). */
export const compassLabel = (deg) =>
  deg == null ? '--' : DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/* Photo categories — must match PhotoCategories.all in the mobile app, because
 * the PDF generator groups by these exact strings. */
export const PHOTO_CATEGORIES = [
  'Site Photos',
  'DG Photos',
  'Battery Photos',
  'SMPS Photos',
  'PIU/AMF Photos',
  'Infrastructure Photos',
  'Label / Nameplate Photos',
  'Other Photos',
];

/** The category that carries the mandatory south-facing shot. */
export const SITE_CATEGORY = 'Site Photos';

/* Reserved single-slot categories rendered at fixed positions in the report.
 * Main Gate is the FIRST picture, SMPS Label the LAST (client requirement). */
export const CAT_MAIN_GATE = 'Main Gate';
export const CAT_SMPS_LABEL = 'SMPS Label';
export const CAT_SELFIE = 'Surveyor Selfie';
export const CAT_LAYOUT = 'Layout';

export const FEASIBILITY_OPTIONS = ['Feasible', 'Conditional Feasible', 'Not Feasible'];

/** Quick-pick reasons for "Not Done" — mirrors NotDoneReasons.all. */
export const NOT_DONE_REASONS = [
  'Access denied / gate locked',
  'Site not found / wrong address',
  'Owner or contact unavailable',
  'Unsafe conditions / weather',
  'Duplicate / already surveyed',
];

/** Turns "Site Photos" into "site_photos" — same slug rule as the mobile app. */
export const slug = (label) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
