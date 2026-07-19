/* Survey form definition — the single source of truth for what the PWA asks.
 *
 * Mirrors the mobile wizard (mobile/lib/screens/survey_wizard_screen.dart) and
 * TableDefs / SurveySteps in mobile/lib/utils/constants.dart. Every `key` here
 * matches a key in Survey.toJson() (mobile/lib/models/survey.dart) so the JSON
 * this app writes to survey_data.form is byte-compatible with the app's — the
 * existing PDF generator and the Ops portal editor read both identically.
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

/* The ordered steps. `type` drives which renderer app.js uses:
 *   fields | table | load | photos | layout
 */
export const STEPS = [
  {
    id: 'general',
    title: 'General Information',
    type: 'fields',
    // Two mandatory single-shot photos captured right at the start.
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
    gps: true, // renders the "Use my GPS" button, fills latitude/longitude/gpsAccuracy
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
  { id: 'battery', title: 'Battery Details', type: 'table', tableKey: 'battery' },
  { id: 'piuAmf',  title: 'PIU / AMF',       type: 'table', tableKey: 'piuAmf' },
  { id: 'smps',    title: 'SMPS Details',    type: 'table', tableKey: 'smps' },
  { id: 'dg',      title: 'DG Details',      type: 'table', tableKey: 'dg' },
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

/* Submit gate — mirrors _validateForSubmit() in the mobile wizard.
 * NOTE: like the app, a south-facing Site Photo is strongly prompted but not a
 * hard block; only the presence of a Site Photo is enforced. Keep the two in
 * step if that rule ever changes. */
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
