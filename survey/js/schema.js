/* Survey form definition — the single source of truth for what the PWA asks.
 *
 * This is an EXACT replica of the mobile wizard's flow
 * (mobile/lib/screens/survey_wizard_screen.dart, build list ~line 288) and
 * TableDefs / SurveySteps in mobile/lib/utils/constants.dart:
 *
 *   1 General Information   Main Gate slot + Selfie slot + fields
 *   2 Solar Resource        GPS + NASA auto-fill + fields
 *   3 Battery Details       table + Battery Photos
 *   4 PIU / AMF             table + PIU/AMF Photos
 *   5 SMPS Details          table + SMPS Photos
 *   6 DG Details            table + DG Photos
 *   7 Load Details          two fixed sub-sections
 *   8 Observations          fields
 *   9 Photos                Site / Infrastructure / Label / Other + SMPS Label slot
 *  10 Layout                Layout Images
 *
 * Equipment photos are captured INSIDE their own section (you photograph the
 * battery bank while standing at it); the Photos step holds only the site-wide
 * categories. This mirrors _sectionPhotoCard() / _stepPhotos() in the app.
 *
 * Every `key` matches a key in Survey.toJson() (mobile/lib/models/survey.dart)
 * so the JSON written to survey_data.form is byte-compatible with the app's —
 * the PDF generators and the Ops portal editor read both identically.
 *
 * NOTE (Phase 3.7): dayLength*, tilt* and powerProduction were removed from the
 * surveyor's Solar Resource step. powerProduction is filled by the CLIENT in the
 * portal. The model keys still exist for back-compat but are not asked here.
 */
import { FEASIBILITY_OPTIONS } from './config.js';

/** Column sets for the dynamic tables — mirrors TableDefs. */
export const TABLE_DEFS = {
  smps: [
    { key: 'capacity', label: 'Total PP Capacity (KW)' },
    { key: 'make', label: 'Make' },
    { key: 'controllerModel', label: 'Controller Model' },
    // Delta SMPS are identified by an FG Number, everything else by a serial.
    { key: 'fgNumber', label: 'FG No. / Serial No.',
      dynamicLabel: (row) => (row.make || '').toLowerCase().includes('delta')
        ? 'FG Number (Delta)' : 'Serial No.' },
  ],
  battery: [
    { key: 'capacity', label: 'Capacity (Ah)' },
    { key: 'make', label: 'Make' },
    { key: 'type', label: 'Type (VRLA / Li-Ion)' },
    { key: 'bankSize', label: 'Total Battery Bank Size' },
  ],
  piuAmf: [
    { key: 'type', label: 'Type', options: ['PIU', 'AMF'] },
    { key: 'capacity', label: 'Capacity (KW)', numeric: true },
    { key: 'make', label: 'Make' },
  ],
  dg: [
    { key: 'capacity', label: 'Capacity (KVA)' },
    { key: 'make', label: 'Make' },
  ],
};

/* `type` drives the main renderer: fields | table | load | photos | layout.
 * Any step may additionally carry `photos` (category blocks) and `slots`
 * (single-shot reserved categories). */
export const STEPS = [
  {
    id: 'general',
    title: 'General Information',
    type: 'fields',
    slots: [
      { key: 'mainGatePhoto', label: 'Main Gate photo', required: true,
        hint: 'Appears FIRST in the report.' },
      { key: 'selfiePhoto', label: 'Selfie with site technician / supervisor',
        required: true, selfie: true, hint: 'Proof of an attended survey.' },
    ],
    fields: [
      { key: 'siteId', label: 'Site ID', required: true },
      { key: 'siteName', label: 'Site Name', required: true },
      { key: 'siteAddress', label: 'Site Address', type: 'textarea' },
      { key: 'surveyDate', label: 'Survey Date', type: 'date' },
      { key: 'engineerName', label: 'Surveyor Name' },
      { key: 'circle', label: 'Circle' },
      { key: 'customerName', label: 'Customer Name' },
      { key: 'contactNumber', label: 'Contact Number', type: 'tel' },
    ],
  },
  {
    id: 'solar',
    title: 'Solar Resource',
    type: 'fields',
    gps: true,       // "Use my GPS" button -> latitude / longitude / gpsAccuracy
    solarFill: true, // "Auto-fill from NASA" button -> wind / insolation / temperatures
    fields: [
      { key: 'latitude', label: 'Latitude', required: true, type: 'number' },
      { key: 'longitude', label: 'Longitude', required: true, type: 'number' },
      { key: 'windSpeed', label: 'Average Wind Speed (m/s)', type: 'number' },
      { key: 'insolationAnnual', label: 'Total Global Insolation (kWh/m²/year)', type: 'number' },
      { key: 'temperatureAvg', label: 'Average Temperature (°C)', type: 'number' },
      { key: 'temperatureMax', label: 'Max Temperature (°C)', type: 'number' },
      { key: 'temperatureMin', label: 'Min Temperature (°C)', type: 'number' },
    ],
  },
  { id: 'battery', title: 'Battery Details', type: 'table', tableKey: 'battery',
    photos: [{ category: 'Battery Photos' }] },
  { id: 'piuAmf', title: 'PIU / AMF', type: 'table', tableKey: 'piuAmf',
    photos: [{ category: 'PIU/AMF Photos' }] },
  { id: 'smps', title: 'SMPS Details', type: 'table', tableKey: 'smps',
    photos: [{ category: 'SMPS Photos' }] },
  { id: 'dg', title: 'DG Details', type: 'table', tableKey: 'dg',
    photos: [{ category: 'DG Photos' }] },
  {
    id: 'load',
    title: 'Load Details',
    type: 'load',
    // Two fixed sub-sections (not add-multiple), each Load Type / Voltage / Current.
    groups: [
      { title: 'Active Load', keys: {
          loadType: 'activeLoadType', voltage: 'activeLoadVoltage', current: 'activeLoadCurrent' } },
      { title: 'Battery Discharging Condition', keys: {
          loadType: 'batteryDischargeLoadType', voltage: 'batteryDischargeVoltage',
          current: 'batteryDischargeCurrent' } },
    ],
  },
  {
    id: 'observations',
    title: 'Observations',
    type: 'fields',
    fields: [
      { key: 'observations', label: 'Observations', type: 'textarea' },
      { key: 'plotDimension', label: 'Plot Dimension' },
      { key: 'boundaryConfirmedBy', label: 'Boundary Confirmed By' },
      { key: 'generalRemarks', label: 'General Remarks', type: 'textarea' },
      { key: 'feasibility', label: 'Survey Feasibility Status', type: 'select',
        options: FEASIBILITY_OPTIONS, required: true },
    ],
  },
  {
    id: 'photos',
    title: 'Photos',
    type: 'photos',
    note: 'Camera photos show a live compass and are stamped with GPS, time & bearing. '
        + 'Equipment photos are taken inside their own sections.',
    photos: [
      // At least one Site Photo is required, but it does NOT have to face south
      // (see validateForSubmit) — same as the APK.
      { category: 'Site Photos', required: true },
      { category: 'Infrastructure Photos' },
      { category: 'Label / Nameplate Photos' },
      { category: 'Other Photos' },
    ],
    slots: [
      { key: 'smpsLabelPhoto', label: 'SMPS Label photo',
        hint: 'Appears LAST in the report. Optional.' },
    ],
  },
  { id: 'layout', title: 'Layout', type: 'layout' },
];

/** Blank survey document — every key the mobile Survey model serialises. */
export function blankSurvey() {
  return {
    siteId: '', siteName: '', siteAddress: '', surveyDate: '',
    engineerName: '', circle: '', customerName: '', contactNumber: '',
    latitude: '', longitude: '', gpsAccuracy: '',
    windSpeed: '', insolationAnnual: '',
    temperatureAvg: '', temperatureMax: '', temperatureMin: '',
    // Kept for back-compat with the report model; not asked in this app.
    dayLengthMin: '', dayLengthMax: '',
    tiltYearly: '', tiltSummer: '', tiltWinter: '', powerProduction: '',
    smps: [], battery: [], piuAmf: [], dg: [],
    activeLoadType: '', activeLoadVoltage: '', activeLoadCurrent: '',
    batteryDischargeLoadType: '', batteryDischargeVoltage: '', batteryDischargeCurrent: '',
    observations: '', plotDimension: '', boundaryConfirmedBy: '',
    generalRemarks: '', feasibility: '',
  };
}

/* Submit gate — mirrors _validateForSubmit() in the mobile wizard exactly.
 *
 * A south-facing Site Photo is deliberately NOT required (user decision,
 * 2026-07-19): it is not enforced in the APK and must not be enforced here.
 * The compass is still shown while capturing and `isSouthFacing` is still
 * recorded and badged on the photo — it just doesn't gate submission. */
export function validateForSubmit(doc, photos) {
  if (!doc.siteId.trim()) return { step: 'general', msg: 'Site ID is required to submit.' };
  if (!doc.siteName.trim()) return { step: 'general', msg: 'Site Name is required to submit.' };
  if (!photos.mainGatePhoto) return { step: 'general', msg: 'A Main Gate photo is required.' };
  if (!photos.selfiePhoto) {
    return { step: 'general', msg: 'A selfie with the site technician/supervisor is required.' };
  }
  const lat = parseFloat(doc.latitude), lng = parseFloat(doc.longitude);
  if (!doc.latitude.trim() || isNaN(lat) || lat < -90 || lat > 90) {
    return { step: 'solar', msg: 'A valid Latitude is required.' };
  }
  if (!doc.longitude.trim() || isNaN(lng) || lng < -180 || lng > 180) {
    return { step: 'solar', msg: 'A valid Longitude is required.' };
  }
  const site = (photos.categories && photos.categories['Site Photos']) || [];
  if (!site.length) return { step: 'photos', msg: 'At least one Site Photo is required.' };
  if (!doc.feasibility.trim()) {
    return { step: 'observations', msg: 'Select a Survey Feasibility status.' };
  }
  return null;
}
