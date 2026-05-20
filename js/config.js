// =============================================================
// config.js
// Supabase-oppsett, global tilstand og hjelpefunksjoner
// som brukes av alle andre filer.
// =============================================================

// ── Supabase-tilkobling ──────────────────────────────────────
const supabaseUrl = 'https://gtebkasmqdvqhwesqkcq.supabase.co';
const supabaseKey = 'sb_publishable_fh-IwZS8DpRwwU_ETq7yZg_QvezjZe5';
const db = supabase.createClient(supabaseUrl, supabaseKey);

// ── Global applikasjonstilstand ──────────────────────────────
// All data lastet fra Supabase ligger her.
// Brukes av renderUI(), updateChart() og alle save-funksjoner.
let data = {
    employees:   [],  // Ansatte fra 'ansatte'-tabellen
    projects:    [],  // Prosjekter fra 'prosjekter'-tabellen
    assignments: [],  // Bemanning fra 'bemanning'-tabellen
    timeline:    []   // Generert tidslinje (uker)
};

// Holder styr på hvilke ansatte/prosjekter som er ekspandert i tabellen
let expanded = new Set();

// Prosjekter lagt til i denne sesjonen som ikke ennå har prosent-verdi.
// Brukes for å vise raden selv om filtrering på "aktive siste 6 uker" ville skjult den.
let nyligLagtTil = new Set();

let chartInstance    = null;  // Chart.js-instansen, lagres for å ødelegge den før ny tegning
let activeAssigneeId = null;  // UUID til ansatt aktiv i "Tildel prosjekt"-modal
let currentWeekId    = "";    // f.eks. "u17/26" – inneværende uke
let currentUserEmail = "";
let currentUserId    = "";
let currentUserRole  = "ansatt"; // "ansatt" | "admin" | "superbruker"

// ── Undo-stack ───────────────────────────────────────────────
// En liste med angre-operasjoner (maks MAX_UNDO innslag).
// Hver oppføring er en array: [{ ansattId, prosjektId, uke, oldValue, oldUsikker }]
const undoStack = [];
const MAX_UNDO  = 50;

// Settes til true under batch-operasjoner (fyll måned/kvartal osv.)
// slik at hvert enkelt save()-kall ikke pusher sin egen undo-entry.
let _batchUndoActive = false;

// ── Pending saves ────────────────────────────────────────────
// Celler endret men ikke lagret ennå (venter på 500ms debounce).
// Nøkkel: "ansattId_prosjektId_uke"
// Verdi:  { ansattId, prosjektId, uke, value, origValue, origUsikker }
const saveTimeouts = {}; // Debounce-timere per celle-ID
const pendingSaves = {}; // Data som venter på lagring til Supabase

// ── Søk ─────────────────────────────────────────────────────
let searchTimer; // Timer for debounceSearch()

function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderUI(), 300);
}


// =============================================================
// HJELPEFUNKSJONER
// =============================================================

/**
 * Escaper HTML-spesialtegn for å hindre XSS når vi
 * setter inn databaseverdier direkte i innerHTML.
 */
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Lager en DOM-sikker ID ved å erstatte ulovlige tegn med understrek.
 * Skråstreker i uke-IDer ("u17/26") erstattes med "_".
 */
function safeId(...parts) {
    return parts
        .map(part => String(part).replace(/[^a-zA-Z0-9_-]/g, '_'))
        .join('_');
}

/**
 * Finner en celle i DOM-en via ID.
 * Prøver både normalisert og rå ID for bakoverkompatibilitet.
 */
function findIdCell(prefix, ...parts) {
    const normalized = safeId(prefix, ...parts);
    return (
        document.getElementById(normalized) ||
        document.getElementById([prefix, ...parts].join('_'))
    );
}

/**
 * Bakgrunnsfarge for bemanningsceller basert på prosentverdi.
 * > 100% → rød, >= 90% → grønn, lavere → gul med stigende intensitet.
 */
function getCellColor(v) {
    if (!v || v === 0) return "transparent";
    if (v > 100)       return "rgba(239, 68, 68, 0.35)";
    if (v >= 90)       return "rgba(34, 197, 94, 0.35)";
    return `rgba(234, 179, 8, ${Math.max(0.15, (v / 90) * 0.35)})`;
}

/**
 * Bakgrunnsfarge for "ledig kapasitet"-visning.
 * 0% ledig → grønn, <= 50% → gul, mer enn 50% → rød.
 */
function getLedigColor(v) {
    if (v <= 0)  return "rgba(34, 197, 94, 0.35)";
    if (v <= 50) return "rgba(234, 179, 8, 0.35)";
    return "rgba(239, 68, 68, 0.35)";
}

/**
 * Formaterer en celleverdi for visning i inputfeltet.
 * 0 vises som tom streng. Usikre verdier får "u"-suffiks (f.eks. "50u").
 */
function formatCellValue(v, isUnsure) {
    if (!v) return '';
    return String(v) + (isUnsure ? 'u' : '');
}

/**
 * Bakgrunnsfarge for fraværsvisning – blå gradient basert på prosent.
 * Lav prosent = lys blå, høy prosent = sterkere blå.
 */
function getFravaerColor(v) {
    if (!v || v <= 0) return "transparent";
    const alpha = Math.min(0.65, Math.max(0.15, (v / 100) * 0.65));
    return `rgba(59, 130, 246, ${alpha})`;
}
