import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  isAddress,
} from 'viem';

/* BOT RWA Valuator
   All valuation math is local and rule-based. The only write this app can make
   is the real wallet-approved transaction in recordOnChain(). */

const app = document.querySelector('#app');
const STORAGE_KEY = 'bot-rwa-valuations-v2';
const env = import.meta.env || {};
const CONFIG = {
  rpc: env.VITE_BOT_CHAIN_RPC || env.BOT_CHAIN_RPC || 'https://rpc.botchain.ai',
  chainId: Number(env.VITE_BOT_CHAIN_ID || env.BOT_CHAIN_ID || 677),
  explorer: env.VITE_BOT_CHAIN_EXPLORER || env.BOT_CHAIN_EXPLORER || 'https://scan.botchain.ai/',
  contractAddress: env.VITE_CONTRACT_ADDRESS || env.CONTRACT_ADDRESS || '0xcf3dc4b8ac2F93BdFef419B3b300a56204A109dB',
};

const BOT_CHAIN = defineChain({
  id: CONFIG.chainId,
  name: 'BOT Chain',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpc] } },
  blockExplorers: { default: { name: 'BOT Scan', url: CONFIG.explorer } },
});

const CONTRACT_ABI = [
  {
    type: 'function',
    name: 'recordValuation',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assetId', type: 'string' },
      { name: 'assetType', type: 'string' },
      { name: 'currency', type: 'string' },
      { name: 'estimatedValue', type: 'uint256' },
      { name: 'riskScore', type: 'uint256' },
      { name: 'confidenceScore', type: 'uint256' },
      { name: 'reportHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getValuation',
    stateMutability: 'view',
    inputs: [{ name: 'assetId', type: 'string' }],
    outputs: [
      { name: 'assetId', type: 'string' },
      { name: 'assetType', type: 'string' },
      { name: 'currency', type: 'string' },
      { name: 'estimatedValue', type: 'uint256' },
      { name: 'riskScore', type: 'uint256' },
      { name: 'confidenceScore', type: 'uint256' },
      { name: 'reportHash', type: 'bytes32' },
      { name: 'submitter', type: 'address' },
      { name: 'timestamp', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'ValuationRecorded',
    anonymous: false,
    inputs: [
      { indexed: false, name: 'assetId', type: 'string' },
      { indexed: false, name: 'assetType', type: 'string' },
      { indexed: false, name: 'currency', type: 'string' },
      { indexed: false, name: 'estimatedValue', type: 'uint256' },
      { indexed: false, name: 'riskScore', type: 'uint256' },
      { indexed: false, name: 'confidenceScore', type: 'uint256' },
      { indexed: false, name: 'reportHash', type: 'bytes32' },
      { indexed: true, name: 'submitter', type: 'address' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
  },
];

const state = {
  view: 'dashboard',
  screen: 'form',
  mobileNav: false,
  modal: null,
  toast: null,
  filter: 'all',
  isCalculating: false,
  isRecording: false,
  recordStatus: 'idle',
  verification: 'idle',
  result: null,
  valuations: loadValuations(),
  chainValuations: [],
  chainError: '',
  wallet: { address: '', chainId: null, status: 'disconnected' },
  form: {
    assetId: '',
    assetType: 'Real Estate',
    currency: 'USD',
    valuationDate: new Date().toISOString().slice(0, 10),
    location: '',
    propertyType: 'Residential',
    size: '',
    yearBuilt: '',
    condition: 'Good',
    rentalIncome: '',
    purchasePrice: '',
  },
};

let walletClient;
let publicClient;

const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6"/><path d="M16 14h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="m15 18-6-6 6-6M9 12h11"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  external: '<path d="M14 3h7v7M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0-14.8-3L3 11M3 5v6h6M4 13a8.1 8.1 0 0 0 14.8 3L21 13m0 6v-6h-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  pulse: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
};

function icon(name, size = 16) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || ''}</svg>`;
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
function loadValuations() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveValuations() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.valuations)); } catch { /* Storage is optional. */ }
}
function validContract() { return isAddress(CONFIG.contractAddress); }
function chainReady() { return validContract(); }
function onBotChain() { return state.wallet.chainId === CONFIG.chainId; }
function money(value, currency = 'USD') {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}
function shortHash(value) { return value ? `${value.slice(0, 14)}…${value.slice(-10)}` : 'Not generated'; }
function shortAddress(value) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : ''; }
function dateLabel(date) {
  try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date)); } catch { return 'Unknown date'; }
}
function showToast(message, type = 'info') {
  state.toast = { message, type };
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { state.toast = null; render(); }, 4200);
}
function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = stableObject(value[key]); return out; }, {});
  return value;
}
async function hashReport(record) {
  const report = {
    schema: 'bot-rwa-valuator/v1',
    assetId: record.assetId,
    assetType: record.assetType,
    inputs: record.inputs,
    estimatedValue: record.estimatedValue,
    currency: record.currency,
    riskScore: record.riskScore,
    confidenceScore: record.confidenceScore,
    summary: record.summary,
    factors: record.factors,
  };
  const serialized = JSON.stringify(stableObject(report));
  if (!window.crypto?.subtle) throw new Error('Browser cryptography is unavailable; the report hash cannot be generated.');
  const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return `0x${Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/* ------------------------- VALUATION ENGINE ------------------------- */
const LOCATION_FACTOR = { 'United States': 1.0, 'United Kingdom': 0.94, 'European Union': 0.91, Singapore: 1.08, 'United Arab Emirates': 0.98, Nigeria: 0.72, Other: 0.8 };
const CONDITION_FACTOR = { Excellent: 1.12, Good: 1, Fair: 0.86, Poor: 0.68 };
const PROPERTY_FACTOR = { Residential: 1, Commercial: 1.18, Industrial: 0.92, Land: 0.72 };
const RELIABILITY_FACTOR = { Excellent: 0.97, Good: 0.9, Fair: 0.76, Poor: 0.56 };

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clamp(value, min = 0, max = 100) { return Math.min(max, Math.max(min, Math.round(value))); }
function roundValue(value) { return Math.max(0, Math.round(value)); }
function ageFactor(age) { return Math.max(0.45, 1 - Math.max(0, age) * 0.018); }

function evaluateRealEstate(f) {
  const size = num(f.size);
  const valuationYear = new Date(f.valuationDate || '2026-01-01').getFullYear();
  const year = num(f.yearBuilt, valuationYear);
  const age = Math.max(0, valuationYear - year);
  const location = LOCATION_FACTOR[f.location] || LOCATION_FACTOR.Other;
  const type = PROPERTY_FACTOR[f.propertyType] || 1;
  const condition = CONDITION_FACTOR[f.condition] || 1;
  const purchase = num(f.purchasePrice);
  const rental = num(f.rentalIncome);
  const marketValue = size * 1850 * location * type * condition * ageFactor(age);
  const incomeValue = rental * 12 / 0.075;
  const estimate = roundValue((marketValue * 0.55) + (incomeValue * 0.25) + ((purchase || marketValue) * 0.20));
  const risk = clamp(67 - (location * 18) - (condition * 14) - (rental > 0 ? 12 : 0) + (age * 0.2));
  const confidence = clamp(56 + (size > 0 ? 10 : 0) + (purchase > 0 ? 10 : 0) + (rental > 0 ? 12 : 0) + (year > 1900 ? 7 : 0) + (f.location ? 5 : 0));
  return {
    estimatedValue: estimate, currency: f.currency, riskScore: risk, confidenceScore: confidence,
    summary: 'Estimated from location, property characteristics, condition, income potential, and purchase basis using a transparent weighted model.',
    factors: ['Location market factor', 'Property type and size', 'Age and condition', 'Rental income capitalization', 'Purchase price anchor'],
    low: roundValue(estimate * 0.86), high: roundValue(estimate * 1.14),
  };
}

function evaluateVehicle(f) {
  const valuationYear = new Date(f.valuationDate || '2026-01-01').getFullYear();
  const age = Math.max(0, valuationYear - num(f.year, valuationYear));
  const purchase = num(f.purchasePrice);
  const base = purchase || 25000;
  const mileagePenalty = Math.min(0.35, num(f.mileage) / 100000 * 0.22);
  const condition = CONDITION_FACTOR[f.condition] || 1;
  const estimate = roundValue(base * Math.pow(0.86, age) * (1 - mileagePenalty) * condition);
  return {
    estimatedValue: estimate, currency: f.currency, riskScore: clamp(24 + age * 3 + mileagePenalty * 65 + (1 - condition) * 40),
    confidenceScore: clamp(58 + (purchase > 0 ? 14 : 0) + (f.mileage ? 12 : 0) + (f.make ? 7 : 0) + (f.model ? 7 : 0)),
    summary: 'Estimated from purchase basis with configurable annual depreciation, mileage drag, and condition adjustment.',
    factors: ['Annual depreciation curve', 'Mileage adjustment', 'Vehicle condition', 'Purchase price basis', 'Vehicle identity completeness'],
    low: roundValue(estimate * 0.82), high: roundValue(estimate * 1.18),
  };
}

function evaluateEquipment(f) {
  const original = num(f.originalValue);
  const age = num(f.age);
  const usageFactor = { Low: 1, Medium: 0.9, High: 0.78 }[f.usage] || 0.9;
  const condition = CONDITION_FACTOR[f.condition] || 1;
  const estimate = roundValue((original || 15000) * Math.max(0.35, 1 - age * 0.09) * usageFactor * condition);
  return {
    estimatedValue: estimate, currency: f.currency,
    riskScore: clamp(28 + age * 4 + (1 - usageFactor) * 55 + (1 - condition) * 28),
    confidenceScore: clamp(61 + (original > 0 ? 16 : 0) + (f.equipmentType ? 8 : 0) + (f.condition ? 7 : 0)),
    summary: 'Estimated from original value, straight-line useful-life depreciation, usage intensity, and condition.',
    factors: ['Equipment age depreciation', 'Usage intensity', 'Condition adjustment', 'Original value basis', 'Equipment type'],
    low: roundValue(estimate * 0.8), high: roundValue(estimate * 1.2),
  };
}

function evaluateAgricultural(f) {
  const quantity = num(f.quantitySize);
  const output = num(f.annualOutput);
  const purchase = num(f.purchasePrice);
  const location = LOCATION_FACTOR[f.location] || LOCATION_FACTOR.Other;
  const condition = CONDITION_FACTOR[f.condition] || 1;
  const outputValue = output * 3.4 * location;
  const baseValue = quantity * 720 * ageFactor(num(f.age)) * condition;
  const estimate = roundValue((baseValue * 0.45) + (outputValue * 0.3) + ((purchase || baseValue) * 0.25));
  return {
    estimatedValue: estimate, currency: f.currency,
    riskScore: clamp(57 - location * 15 + num(f.age) * 2 + (1 - condition) * 35 + (output ? -10 : 8)),
    confidenceScore: clamp(50 + (quantity ? 12 : 0) + (output ? 15 : 0) + (purchase ? 10 : 0) + (f.location ? 7 : 0) + (f.condition ? 6 : 0)),
    summary: 'Estimated from quantity or size, location, age, condition, annual output potential, and purchase basis.',
    factors: ['Location productivity factor', 'Quantity or size', 'Asset age and condition', 'Annual output potential', 'Purchase price anchor'],
    low: roundValue(estimate * 0.8), high: roundValue(estimate * 1.2),
  };
}

function evaluateInvoice(f) {
  const amount = num(f.invoiceAmount);
  const age = num(f.invoiceAge);
  const reliability = RELIABILITY_FACTOR[f.reliability] || 0.76;
  const termsFactor = { 'Net 15': 1.0, 'Net 30': 0.98, 'Net 60': 0.94, 'Net 90': 0.88, 'Due on receipt': 1.02 }[f.paymentTerms] || 0.94;
  const asOf = new Date(f.valuationDate || '2026-01-01').getTime();
  const due = f.dueDate ? (new Date(f.dueDate).getTime() - asOf) / 86400000 : 30;
  const maturityFactor = due < 0 ? Math.max(0.55, 1 + due / 250) : Math.min(1.04, 1 + due / 1000);
  const estimate = roundValue(amount * reliability * termsFactor * maturityFactor * Math.max(0.72, 1 - age * 0.012));
  return {
    estimatedValue: estimate, currency: f.currency,
    riskScore: clamp(31 + age * 2.2 + (1 - reliability) * 95 + (due < 0 ? 16 : 0) + (amount > 0 ? 0 : 20)),
    confidenceScore: clamp(54 + (amount > 0 ? 17 : 0) + (f.dueDate ? 9 : 0) + (f.reliability ? 12 : 0) + (f.paymentTerms ? 8 : 0)),
    summary: 'Estimated from invoice amount, payment reliability, age, terms, and maturity relative to the due date.',
    factors: ['Customer payment reliability', 'Invoice age', 'Payment terms', 'Due-date maturity', 'Invoice amount'],
    low: roundValue(estimate * 0.9), high: roundValue(estimate * 1.08),
  };
}

function calculateValuation(f) {
  if (f.assetType === 'Vehicle') return evaluateVehicle(f);
  if (f.assetType === 'Equipment') return evaluateEquipment(f);
  if (f.assetType === 'Agricultural Asset') return evaluateAgricultural(f);
  if (f.assetType === 'Invoice') return evaluateInvoice(f);
  return evaluateRealEstate(f);
}

function validateForm(f) {
  const required = {
    'Real Estate': ['location', 'size', 'yearBuilt', 'rentalIncome', 'purchasePrice'],
    Vehicle: ['make', 'model', 'year', 'mileage', 'purchasePrice'],
    Equipment: ['equipmentType', 'age', 'originalValue'],
    'Agricultural Asset': ['agAssetType', 'location', 'quantitySize', 'age', 'annualOutput', 'purchasePrice'],
    Invoice: ['invoiceAmount', 'invoiceAge', 'dueDate'],
  }[f.assetType] || [];
  if (!f.assetId.trim()) return 'Add an asset ID so the report can be verified and retrieved on-chain.';
  const missing = required.find((key) => String(f[key] ?? '').trim() === '');
  if (missing) return 'Complete all required asset fields before running the valuation.';
  if (f.assetType === 'Real Estate' && num(f.rentalIncome) < 0) return 'Rental income cannot be negative.';
  return '';
}

/* ----------------------------- UI ---------------------------------- */
function navMarkup() {
  return `<aside class="sidebar ${state.mobileNav ? 'open' : ''}">
    <div class="brand"><div class="brand-mark">BOT</div><div><div class="brand-name">RWA Valuator</div><div class="brand-sub">Trust layer / 01</div></div></div>
    <div class="nav-label">Workspace</div>
    <nav class="nav" aria-label="Primary navigation">
      <button class="nav-item ${state.view === 'dashboard' ? 'active' : ''}" data-action="dashboard">${icon('grid', 16)}<span>Valuator</span></button>
      <button class="nav-item ${state.view === 'valuations' ? 'active' : ''}" data-action="valuations">${icon('file', 16)}<span>My valuations</span></button>
    </nav>
    <div class="sidebar-bottom"><div class="chain-chip"><i class="chain-dot"></i><span>BOT Chain <span style="color:var(--muted-2)">mainnet</span></span></div><div class="version">MVP BUILD · LOCAL RULESET</div></div>
  </aside>`;
}
function topbar() {
  const connected = state.wallet.status === 'connected';
  const wrong = state.wallet.status === 'wrong-network';
  return `<header class="topbar"><div class="breadcrumb"><button class="mobile-menu" data-action="toggle-nav" aria-label="Open navigation">${icon('menu', 17)}</button><span style="margin-left:10px">Workspace / </span><strong>${state.view === 'dashboard' ? 'Valuator' : 'My valuations'}</strong></div>
    <div class="top-actions"><div class="network-badge ${connected ? 'good' : ''}"><i class="dot"></i><span>${connected ? 'BOT Chain' : wrong ? 'Wrong network' : 'Chain not connected'}</span></div>
    <button class="wallet-btn ${connected ? 'connected' : ''}" data-action="wallet">${icon('wallet', 14)}<span>${connected ? shortAddress(state.wallet.address) : 'Connect wallet'}</span></button></div></header>`;
}
function field(label, name, options = {}) {
  const value = state.form[name] ?? '';
  const optional = options.optional ? '<span>optional</span>' : options.suffix ? `<span>${esc(options.suffix)}</span>` : '';
  const control = options.select
    ? `<select id="${name}" name="${name}">${options.select.map((item) => `<option value="${esc(item)}" ${String(value) === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select>`
    : `<input id="${name}" name="${name}" type="${options.type || 'text'}" value="${esc(value)}" ${options.min !== undefined ? `min="${options.min}"` : ''} ${options.max !== undefined ? `max="${options.max}"` : ''} placeholder="${esc(options.placeholder || '')}" ${options.step ? `step="${options.step}"` : ''} />`;
  return `<div class="field ${options.full ? 'full' : ''}"><label for="${name}">${esc(label)} ${optional}</label>${options.currency ? `<div class="input-wrap">${control}<span class="currency">${esc(state.form.currency || 'USD')}</span></div>` : control}</div>`;
}
function dynamicFields() {
  const common = field('Asset ID', 'assetId', { placeholder: 'e.g. LAGOS-APT-001', suffix: 'required' }) + field('Currency', 'currency', { select: ['USD', 'EUR', 'GBP', 'NGN', 'SGD'] });
  if (state.form.assetType === 'Vehicle') return common + field('Make', 'make', { placeholder: 'e.g. Toyota' }) + field('Model', 'model', { placeholder: 'e.g. Camry' }) + field('Year', 'year', { type: 'number', min: 1900, max: 2100 }) + field('Mileage', 'mileage', { type: 'number', min: 0, suffix: 'km' }) + field('Condition', 'condition', { select: ['Excellent', 'Good', 'Fair', 'Poor'] }) + field('Purchase price', 'purchasePrice', { type: 'number', min: 0, currency: true });
  if (state.form.assetType === 'Equipment') return common + field('Equipment type', 'equipmentType', { placeholder: 'e.g. CNC machine' }) + field('Age', 'age', { type: 'number', min: 0, suffix: 'years' }) + field('Condition', 'condition', { select: ['Excellent', 'Good', 'Fair', 'Poor'] }) + field('Original value', 'originalValue', { type: 'number', min: 0, currency: true }) + field('Usage intensity', 'usage', { select: ['Low', 'Medium', 'High'] });
  if (state.form.assetType === 'Agricultural Asset') return common + field('Asset type', 'agAssetType', { select: ['Farmland', 'Livestock', 'Crop inventory', 'Orchard', 'Aquaculture'] }) + field('Location', 'location', { select: Object.keys(LOCATION_FACTOR) }) + field('Quantity / size', 'quantitySize', { type: 'number', min: 0 }) + field('Age', 'age', { type: 'number', min: 0, suffix: 'years' }) + field('Condition', 'condition', { select: ['Excellent', 'Good', 'Fair', 'Poor'] }) + field('Annual output', 'annualOutput', { type: 'number', min: 0, currency: true }) + field('Purchase price', 'purchasePrice', { type: 'number', min: 0, currency: true });
  if (state.form.assetType === 'Invoice') return common + field('Invoice amount', 'invoiceAmount', { type: 'number', min: 0, currency: true }) + field('Invoice age', 'invoiceAge', { type: 'number', min: 0, suffix: 'days' }) + field('Payment terms', 'paymentTerms', { select: ['Due on receipt', 'Net 15', 'Net 30', 'Net 60', 'Net 90'] }) + field('Customer reliability', 'reliability', { select: ['Excellent', 'Good', 'Fair', 'Poor'] }) + field('Due date', 'dueDate', { type: 'date' });
  return common + field('Location', 'location', { select: Object.keys(LOCATION_FACTOR) }) + field('Property type', 'propertyType', { select: ['Residential', 'Commercial', 'Industrial', 'Land'] }) + field('Size', 'size', { type: 'number', min: 0, suffix: 'sq ft' }) + field('Year built', 'yearBuilt', { type: 'number', min: 1800, max: 2100 }) + field('Condition', 'condition', { select: ['Excellent', 'Good', 'Fair', 'Poor'] }) + field('Rental income', 'rentalIncome', { type: 'number', min: 0, currency: true }) + field('Purchase price', 'purchasePrice', { type: 'number', min: 0, currency: true });
}
function dashboard() {
  if (state.screen === 'result') return resultView();
  return `<main class="page"><section class="hero"><div><div class="eyebrow">BOT RWA Valuator / BOT Chain</div><h1>Make the value legible.</h1><p class="hero-copy">Analyze real-world assets with a transparent local ruleset, then anchor the report on BOT Chain when you are ready.</p><button class="primary-btn hero-cta" data-action="focus-form">${icon('plus', 14)} Start valuation</button></div><div class="hero-meta"><div class="hero-meta-label">Valuation engine</div><div class="hero-meta-value"><span>v1.0</span> · local rules</div></div></section>
    <section class="workflow"><div class="panel"><div class="panel-head"><div><div class="panel-title">New valuation</div><div class="panel-note">Start with the facts you can verify.</div></div><div class="step-count">01 / 01</div></div>
      <form id="valuation-form" class="form-body">${state.isCalculating ? '<div class="loading-bar"><i></i></div>' : ''}${state.toast?.type === 'error' ? `<div class="notice danger">${icon('info', 15)}<span>${esc(state.toast.message)}</span></div>` : ''}<div class="field"><label for="asset-type">Asset type</label><select id="asset-type" name="assetType">${['Real Estate', 'Vehicle', 'Equipment', 'Agricultural Asset', 'Invoice'].map((x) => `<option value="${x}" ${state.form.assetType === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field-grid">${dynamicFields()}</div>
      <div class="form-foot"><div class="form-disclaimer">${icon('shield', 13)} Estimates are algorithmic rule-based estimates — not guaranteed market valuations. Nothing is written on-chain until you approve a transaction.</div><button type="submit" class="primary-btn" ${state.isCalculating ? 'disabled' : ''}>${state.isCalculating ? 'Calculating…' : icon('pulse', 15) + ' Run valuation ' + icon('arrow', 14)}</button></div></form></div>
      <aside class="panel insight-card"><div class="insight-kicker"><i class="mini-signal"></i> System readiness</div><h2>Transparent by default.</h2><p>The estimate stays in your browser first. Connect only when you are ready to make a public record.</p><div class="signal-list"><div class="signal-row"><span class="signal-name">Local valuation engine</span><span class="signal-value ready">READY</span></div><div class="signal-row"><span class="signal-name">Report fingerprint</span><span class="signal-value ready">SHA-256</span></div><div class="signal-row"><span class="signal-name">Wallet session</span><span class="signal-value">${state.wallet.status === 'connected' ? 'CONNECTED' : 'DISCONNECTED'}</span></div><div class="signal-row"><span class="signal-name">Contract endpoint</span><span class="signal-value ${chainReady() ? 'ready' : ''}">${chainReady() ? 'CONFIGURED' : 'NOT CONFIGURED'}</span></div></div>${!chainReady() ? `<div class="notice warn" style="margin-top:26px;margin-bottom:0">${icon('info', 14)}<span>Deploy RWAValuator and set VITE_CONTRACT_ADDRESS to enable real writes.</span></div>` : ''}</aside></section>
    <section class="info-strip"><div class="info-cell">${icon('pulse', 16)}<strong>Five asset models</strong><span>Real estate, vehicles, equipment, agriculture, and invoices.</span></div><div class="info-cell">${icon('shield', 16)}<strong>One fingerprint</strong><span>Hash the exact report before sharing or recording it.</span></div><div class="info-cell">${icon('file', 16)}<strong>One audit trail</strong><span>Only a confirmed wallet transaction becomes public.</span></div></section>${recentSection()}</main>`;
}
function recentSection() {
  const rows = state.valuations.slice(0, 3);
  return `<section><div class="section-heading"><div><h2>Recent valuations</h2><p>Records saved in this browser.</p></div>${rows.length ? `<button class="ghost-btn" data-action="valuations">View all ${icon('arrow', 13)}</button>` : ''}</div><div class="panel recent-table">${rows.length ? `<div class="table-head"><span>Asset</span><span>Estimate</span><span>Created</span><span>Record</span></div>${rows.map(rowMarkup).join('')}` : emptyMarkup()}</div></section>`;
}
function statusMarkup(row) {
  if (row.status === 'verified') return '<span class="status verified">Recorded</span>';
  if (row.status === 'pending') return '<span class="status pending">Pending</span>';
  return '<span class="status unrecorded">Local only</span>';
}
function rowMarkup(row) {
  return `<div class="table-row"><div><div class="asset-title">${esc(row.assetId || row.assetName || row.assetType)}</div><div class="asset-sub">${esc(row.assetType)} · ${esc(row.source === 'chain' ? 'BOT Chain' : 'Browser record')}</div></div><div class="table-value"><strong>${money(row.estimatedValue ?? row.value, row.currency)}</strong></div><div class="table-value">${dateLabel(row.createdAt)}</div><div>${row.txHash ? `<a class="table-link" href="${esc(explorerLink(row.txHash))}" target="_blank" rel="noreferrer">${statusMarkup(row)}</a>` : statusMarkup(row)}</div></div>`;
}
function emptyMarkup() {
  return `<div class="empty-state">${'<div class="empty-icon">' + icon('file', 19) + '</div>'}<h3>No valuation records yet</h3><p>Run your first estimate above. It will appear here after you save the report.</p><button class="secondary-btn" data-action="focus-form">Start a valuation ${icon('arrow', 13)}</button></div>`;
}
function scoreMarkup(label, score, tone) {
  return `<div class="score-block"><div class="score-line"><span>${label}</span><strong>${score} / 100</strong></div><div class="meter ${tone}"><i style="width:${score}%"></i></div></div>`;
}
function recordStatusMarkup() {
  if (state.recordStatus === 'error') return `<div class="notice danger" style="margin-top:17px;margin-bottom:0">${icon('info', 14)}<span>${esc(state.result?.recordError || 'The transaction was not confirmed. No valuation was marked as recorded.')}</span></div>`;
  if (state.recordStatus === 'preparing') return `<div class="tx-steps"><span class="active">Preparing transaction</span><span>Waiting for wallet confirmation</span><span>Confirming on BOT Chain</span><span>Valuation recorded</span></div>`;
  if (state.recordStatus === 'wallet') return `<div class="tx-steps"><span class="done">Preparing transaction</span><span class="active">Waiting for wallet confirmation</span><span>Confirming on BOT Chain</span><span>Valuation recorded</span></div>`;
  if (state.recordStatus === 'submitted') return `<div class="tx-steps"><span class="done">Preparing transaction</span><span class="done">Wallet approved</span><span class="active">Confirming on BOT Chain</span><span>Valuation recorded</span></div><div class="tx-hash">Transaction submitted · <code>${shortHash(state.result?.txHash)}</code></div>`;
  if (state.recordStatus === 'confirmed') return `<div class="notice success" style="margin-top:17px;margin-bottom:0">${icon('check', 14)}<span>Valuation recorded on BOT Chain. Receipt confirmed.</span></div>`;
  return '';
}
function resultView() {
  const r = state.result;
  if (!r) return dashboard();
  return `<main class="page result-shell"><button class="back-link" data-action="new-valuation">${icon('back', 14)} New valuation</button><section class="result-hero"><div><div class="eyebrow">Estimate complete / ${esc(r.assetType)}</div><h1>${esc(r.assetId)}</h1><p class="hero-copy">${esc(r.currency)} · generated ${dateLabel(r.createdAt)}</p></div><span class="result-tag">${r.status === 'verified' ? icon('check', 12) + ' Valuation recorded' : icon('pulse', 12) + ' Local estimate ready'}</span></section>
    <section class="result-grid"><div class="panel valuation-card"><div class="valuation-label">Estimated value · ${esc(r.currency)}</div><div class="valuation-number">${money(r.estimatedValue, r.currency)}</div><div class="valuation-range">Indicative range <strong>${money(r.low, r.currency)} – ${money(r.high, r.currency)}</strong></div>${scoreMarkup('Risk score', r.riskScore, 'risk-meter')}${scoreMarkup('Confidence score', r.confidenceScore, 'confidence-meter')}</div>
      <div class="panel method-card"><h2>How this estimate was formed</h2><p>${esc(r.summary)}</p><div class="method-list">${r.factors.map((factor, index) => `<div class="method-item"><div class="method-index">${String(index + 1).padStart(2, '0')}</div><div><strong>${esc(factor)}</strong><span>Included in the local rule-based calculation.</span></div><em>factor</em></div>`).join('')}</div></div></section>
    <section class="result-bottom"><div class="panel record-card"><h2>Record on BOT Chain</h2><p>Only a real wallet signature and confirmed BOT Chain receipt can create the public record.</p>${recordStatusMarkup()}${state.wallet.status === 'wrong-network' ? `<div class="notice danger" style="margin-top:17px;margin-bottom:0">${icon('info', 14)}<span>Switch your wallet to BOT Chain before recording.</span></div>` : ''}${!chainReady() ? `<div class="notice warn" style="margin-top:17px;margin-bottom:0">${icon('info', 14)}<span>Contract not configured — deployment is required. Nothing can be submitted yet.</span></div>` : ''}<div class="record-actions"><button class="primary-btn" data-action="record-chain" ${!chainReady() || state.wallet.status !== 'connected' || state.isRecording || r.status === 'verified' ? 'disabled' : ''}>${state.isRecording ? 'Processing…' : r.status === 'verified' ? 'Recorded on-chain' : 'Record valuation'} ${icon('arrow', 13)}</button><button class="secondary-btn" data-action="save-local">${icon('file', 13)} Save locally</button></div></div>
      <div class="panel hash-card"><h2>Report fingerprint</h2><p>Deterministic SHA-256 of the exact valuation report.</p><div class="hash-row"><code>${shortHash(r.hash)}</code><button data-action="copy-hash" title="Copy report fingerprint" aria-label="Copy report fingerprint">${icon('copy', 15)}</button></div><div class="record-actions"><button class="ghost-btn" data-action="verify-hash">${state.verification === 'success' ? icon('check', 13) + ' Report Verified' : state.verification === 'checking' ? 'Verifying…' : icon('shield', 13) + ' Verify report'}</button>${r.txHash ? `<a class="ghost-btn" href="${esc(explorerLink(r.txHash))}" target="_blank" rel="noreferrer">${icon('external', 13)} BOT Explorer</a>` : ''}</div>${r.txHash ? `<div class="tx-hash" style="margin-top:15px">Transaction hash<br><code>${esc(r.txHash)}</code></div>` : ''}<div class="notice info" style="margin-top:18px;margin-bottom:0">${icon('info', 14)}<span>Algorithmic rule-based estimate — not a guaranteed market valuation.</span></div></div></section></main>`;
}
function valuationsView() {
  const rows = state.valuations.filter((row) => state.filter === 'all' || row.status === state.filter);
  return `<main class="page valuation-page"><section class="section-heading"><div><div class="eyebrow">Wallet-scoped audit view</div><h2 style="font-size:36px;margin-top:10px">My valuations</h2><p style="margin-top:8px">${state.wallet.address ? `Connected wallet ${shortAddress(state.wallet.address)} · chain records are event-backed.` : 'Connect a wallet to read its BOT Chain records. Local records are clearly labeled.'}</p></div><div class="filters">${['all', 'verified', 'local'].map((x) => `<button class="filter-btn ${state.filter === x ? 'active' : ''}" data-filter="${x}">${x === 'all' ? 'All records' : x === 'local' ? 'Local only' : 'Recorded'}</button>`).join('')}</div></section>${state.chainError ? `<div class="notice danger">${icon('info', 15)}<span>${esc(state.chainError)}</span></div>` : !state.wallet.address ? `<div class="notice info">${icon('wallet', 15)}<span>Wallet not connected. Nothing is inferred from an address you have not approved.</span></div>` : ''}<div class="panel recent-table">${rows.length ? `<div class="table-head"><span>Asset</span><span>Estimate</span><span>Created</span><span>Record</span></div>${rows.map(rowMarkup).join('')}` : emptyMarkup()}</div><div class="notice info" style="margin-top:20px">${icon('info', 15)}<span>Local records stay in this browser. Recorded rows come from the ValuationRecorded event after a real confirmed transaction.</span></div></main>`;
}
function walletModal() {
  if (state.modal !== 'wallet') return '';
  const provider = window.ethereum;
  const connected = state.wallet.status === 'connected';
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title"><div class="modal-head"><div><h2 id="wallet-title">Wallet session</h2><p>${provider ? 'Use your browser wallet to connect and approve real BOT Chain transactions.' : 'No browser wallet was detected in this browser.'}</p></div><button class="modal-close" data-action="close-modal" aria-label="Close dialog">${icon('close', 18)}</button></div><div class="wallet-status-card"><div class="option-icon">${icon(connected ? 'check' : 'wallet', 20)}</div><div><strong>${connected ? shortAddress(state.wallet.address) : 'Wallet disconnected'}</strong><small>${connected ? (onBotChain() ? 'Connected to BOT Chain mainnet' : `Connected to chain ${state.wallet.chainId}`) : 'Local valuation remains available.'}</small></div></div><div class="modal-options">${!provider ? '' : !state.wallet.address ? `<button class="modal-option" data-action="connect-wallet"><span class="option-icon">${icon('wallet', 18)}</span><span><strong>Connect browser wallet</strong><small>Connection is free and does not request payment.</small></span></button>` : !onBotChain() ? `<button class="modal-option" data-action="switch-network"><span class="option-icon">${icon('refresh', 18)}</span><span><strong>Switch to BOT Chain</strong><small>Chain ID ${CONFIG.chainId} · BOT is used only for gas on writes.</small></span></button>` : `<div class="notice success" style="margin:0">${icon('check', 15)}<span>Ready for a real BOT Chain transaction.</span></div>`}${state.wallet.address ? `<button class="modal-option" data-action="disconnect-wallet"><span class="option-icon">${icon('close', 18)}</span><span><strong>Disconnect in this app</strong><small>No wallet transaction is required.</small></span></button>` : ''}</div><div class="modal-footnote">${icon('lock', 12)} No private keys, balances, fake hashes, or simulated confirmations are used.</div></section></div>`;
}
function render() {
  const body = state.view === 'dashboard' ? dashboard() : valuationsView();
  app.innerHTML = `${navMarkup()}<div class="main">${topbar()}${body}</div>${walletModal()}${state.toast ? `<div class="toast ${state.toast.type}">${esc(state.toast.message)}</div>` : ''}`;
  bindEvents();
}
function bindEvents() {
  document.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', (event) => {
    if (element.dataset.action === 'close-modal' && event.target !== element && !element.classList.contains('modal-close')) return;
    handleAction(element.dataset.action);
  }));
  document.querySelectorAll('[data-filter]').forEach((element) => element.addEventListener('click', () => { state.filter = element.dataset.filter; render(); }));
  const form = document.querySelector('#valuation-form');
  if (form) {
    form.addEventListener('input', (event) => { if (event.target.name) state.form[event.target.name] = event.target.value; });
    form.addEventListener('change', (event) => {
      if (!event.target.name) return;
      state.form[event.target.name] = event.target.value;
      if (event.target.name === 'assetType') render();
    });
    form.addEventListener('submit', submitValuation);
  }
}
async function submitValuation(event) {
  event.preventDefault();
  const error = validateForm(state.form);
  if (error) { showToast(error, 'error'); return; }
  state.isCalculating = true;
  state.toast = null;
  render();
  await new Promise((resolve) => window.setTimeout(resolve, 450));
  try {
    const estimate = calculateValuation(state.form);
    const record = {
      id: `local-${Date.now()}`, assetId: state.form.assetId.trim(), assetType: state.form.assetType, currency: state.form.currency,
      inputs: { ...state.form }, ...estimate, createdAt: new Date().toISOString(), status: 'local', source: 'browser', txHash: '',
    };
    record.hash = await hashReport(record);
    state.result = record;
    state.screen = 'result';
    state.isCalculating = false;
    state.verification = 'idle';
    state.recordStatus = 'idle';
    render();
  } catch (error) {
    state.isCalculating = false;
    showToast(error.message || 'Could not calculate the valuation.', 'error');
  }
}
function persistResult() {
  if (!state.result) return;
  const existing = state.valuations.findIndex((row) => row.id === state.result.id);
  if (existing >= 0) state.valuations[existing] = state.result;
  else state.valuations.unshift(state.result);
  saveValuations();
}
function explorerLink(hash) { return `${CONFIG.explorer.replace(/\/$/, '')}/tx/${hash}`; }

/* ---------------------- REAL WALLET / CHAIN ------------------------- */
async function connectWallet() {
  if (!window.ethereum) {
    showToast('Install an EVM-compatible browser wallet such as MetaMask to connect.', 'error');
    return;
  }
  try {
    walletClient = createWalletClient({ chain: BOT_CHAIN, transport: custom(window.ethereum) });
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    state.wallet.address = accounts?.[0] || '';
    state.wallet.chainId = await walletClient.getChainId();
    state.wallet.status = state.wallet.chainId === CONFIG.chainId ? 'connected' : 'wrong-network';
    publicClient = createPublicClient({ chain: BOT_CHAIN, transport: http(CONFIG.rpc) });
    state.modal = 'wallet';
    render();
    if (onBotChain()) await loadChainValuations();
  } catch (error) {
    state.wallet = { address: '', chainId: null, status: 'disconnected' };
    showToast(error?.shortMessage || error?.message || 'Wallet connection was cancelled.', 'error');
  }
}
async function refreshWallet() {
  if (!window.ethereum || !state.wallet.address) return;
  try {
    const chainId = await walletClient?.getChainId() ?? Number.parseInt(await window.ethereum.request({ method: 'eth_chainId' }), 16);
    state.wallet.chainId = chainId;
    state.wallet.status = chainId === CONFIG.chainId ? 'connected' : 'wrong-network';
    render();
    if (onBotChain()) await loadChainValuations();
  } catch { /* A wallet may disappear without an actionable error. */ }
}
async function switchNetwork() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${CONFIG.chainId.toString(16)}` }] });
  } catch (error) {
    if (error?.code === 4902) {
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${CONFIG.chainId.toString(16)}`, chainName: 'BOT Chain', nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 }, rpcUrls: [CONFIG.rpc], blockExplorerUrls: [CONFIG.explorer] }] });
    } else {
      showToast(error?.message || 'Network switch was cancelled.', 'error');
      return;
    }
  }
  await refreshWallet();
  state.modal = 'wallet';
  showToast('Wallet is now connected to BOT Chain.', 'success');
}
async function loadChainValuations() {
  if (!publicClient || !validContract() || !state.wallet.address || !onBotChain()) return;
  try {
    const logs = await publicClient.getLogs({ address: CONFIG.contractAddress, event: CONTRACT_ABI[2], args: { submitter: state.wallet.address }, fromBlock: 0n, toBlock: 'latest' });
    state.chainValuations = logs.map((log) => {
      const args = log.args;
      return {
        id: `chain-${log.transactionHash}-${String(log.logIndex)}`, assetId: args.assetId, assetType: args.assetType, estimatedValue: Number(args.estimatedValue), currency: args.currency || 'USD',
        riskScore: Number(args.riskScore), confidenceScore: Number(args.confidenceScore), hash: args.reportHash, createdAt: new Date(Number(args.timestamp) * 1000).toISOString(),
        status: 'verified', source: 'chain', txHash: log.transactionHash,
      };
    }).reverse();
    state.valuations = [...state.valuations.filter((row) => row.source !== 'chain'), ...state.chainValuations];
    saveValuations();
    state.chainError = '';
    render();
  } catch (error) {
    state.chainError = `Could not read BOT Chain events: ${error?.shortMessage || error?.message || 'RPC request failed.'}`;
    render();
  }
}
async function recordOnChain() {
  const r = state.result;
  if (!r || !chainReady()) { showToast('A deployed contract and valuation result are required. Nothing was submitted.', 'error'); return; }
  if (state.wallet.status !== 'connected' || !walletClient) { showToast('Connect a wallet on BOT Chain before recording.', 'error'); return; }
  state.isRecording = true;
  state.recordStatus = 'preparing';
  state.result.recordError = '';
  render();
  try {
    state.recordStatus = 'wallet';
    render();
    const txHash = await walletClient.writeContract({
      address: CONFIG.contractAddress,
      abi: CONTRACT_ABI,
      functionName: 'recordValuation',
      args: [r.assetId, r.assetType, r.currency, BigInt(Math.round(r.estimatedValue)), BigInt(r.riskScore), BigInt(r.confidenceScore), r.hash],
      account: state.wallet.address,
      chain: BOT_CHAIN,
    });
    state.result.txHash = txHash;
    state.recordStatus = 'submitted';
    render();
    state.recordStatus = 'submitted';
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new Error('BOT Chain receipt reported a reverted transaction.');
    state.result.status = 'verified';
    state.result.source = 'chain';
    state.recordStatus = 'confirmed';
    state.isRecording = false;
    persistResult();
    render();
    await loadChainValuations();
  } catch (error) {
    state.isRecording = false;
    state.recordStatus = 'error';
    state.result.recordError = error?.shortMessage || error?.message || 'Transaction was rejected or failed. No valuation was marked as recorded.';
    render();
  }
}
async function verifyReport() {
  if (!state.result) return;
  state.verification = 'checking';
  render();
  try {
    const recreated = await hashReport(state.result);
    if (state.result.status === 'verified' && publicClient && validContract()) {
      const stored = await publicClient.readContract({ address: CONFIG.contractAddress, abi: CONTRACT_ABI, functionName: 'getValuation', args: [state.result.assetId] });
      const storedHash = stored[6];
      if (String(storedHash).toLowerCase() !== recreated.toLowerCase()) throw new Error('The on-chain report hash does not match this report.');
    }
    if (recreated.toLowerCase() !== state.result.hash.toLowerCase()) throw new Error('The recreated report hash does not match.');
    state.verification = 'success';
    render();
    showToast('Report Verified', 'success');
  } catch (error) {
    state.verification = 'error';
    render();
    showToast(error?.message || 'Report verification failed.', 'error');
  }
}

async function handleAction(action) {
  if (action === 'toggle-nav') { state.mobileNav = !state.mobileNav; render(); return; }
  if (action === 'dashboard') { state.view = 'dashboard'; state.screen = 'form'; state.mobileNav = false; render(); return; }
  if (action === 'valuations') { state.view = 'valuations'; state.mobileNav = false; render(); if (onBotChain()) await loadChainValuations(); return; }
  if (action === 'focus-form') { state.view = 'dashboard'; render(); document.querySelector('#asset-id')?.focus(); return; }
  if (action === 'new-valuation') { state.result = null; state.screen = 'form'; state.view = 'dashboard'; state.recordStatus = 'idle'; render(); return; }
  if (action === 'wallet') { state.modal = 'wallet'; render(); if (!state.wallet.address) await connectWallet(); return; }
  if (action === 'connect-wallet') { await connectWallet(); return; }
  if (action === 'switch-network') { await switchNetwork(); return; }
  if (action === 'disconnect-wallet') { state.wallet = { address: '', chainId: null, status: 'disconnected' }; state.modal = null; render(); showToast('Wallet disconnected from this app.'); return; }
  if (action === 'close-modal') { state.modal = null; render(); return; }
  if (action === 'save-local') { persistResult(); showToast('Valuation saved to this browser.', 'success'); return; }
  if (action === 'copy-hash') { if (!state.result?.hash) return; try { await navigator.clipboard.writeText(state.result.hash); showToast('Report fingerprint copied.', 'success'); } catch { showToast('Clipboard access was not available.', 'error'); } return; }
  if (action === 'verify-hash') { await verifyReport(); return; }
  if (action === 'record-chain') { await recordOnChain(); }
}

if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', (accounts) => {
    if (!accounts?.length) state.wallet = { address: '', chainId: null, status: 'disconnected' };
    else { state.wallet.address = accounts[0]; refreshWallet(); }
    render();
  });
  window.ethereum.on('chainChanged', () => refreshWallet());
}
publicClient = createPublicClient({ chain: BOT_CHAIN, transport: http(CONFIG.rpc) });
render();