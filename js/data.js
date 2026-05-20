// =============================================================
// data.js
// Datahenting fra Supabase, ytelsesindeksering og all lagring.
// =============================================================


// =============================================================
// HENTING FRA DATABASE
// =============================================================

/**
 * Laster ansatte, prosjekter og bemanning fra Supabase.
 * Bemanning hentes med paginering siden Supabase returnerer maks
 * 1000 rader per kall – vi looper til vi har alt.
 */
async function fetchData() {
    // Hent ansatte og prosjekter parallelt
    const [emp, proj] = await Promise.all([
        db.from('ansatte').select('*').order('navn'),
        db.from('prosjekter').select('*').order('navn')
    ]);

    data.employees = emp.data  || [];
    data.projects  = proj.data || [];

    // ── Paginer bemanning ────────────────────────────────────
    let allAssignments = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
        const { data: rows, error } = await db
            .from('bemanning')
            .select('*')
            .range(from, from + pageSize - 1);

        if (error || !rows || rows.length === 0) break;

        allAssignments = allAssignments.concat(rows);

        // Hvis vi fikk færre rader enn pageSize er vi ferdige
        if (rows.length < pageSize) break;
        from += pageSize;
    }

    data.assignments = allAssignments;
}


// =============================================================
// YTELSESINDEKSERING
// =============================================================

/**
 * Bygger et sett med Map-baserte oppslagstabeller fra data.assignments.
 * Kalles én gang per renderUI() i stedet for å kjøre .filter() for hver celle.
 *
 * Uten indeksering: O(n) filter × antall celler = millioner av sammenligninger.
 * Med indeksering:  O(n) én gang, deretter O(1) per oppslag.
 *
 * Returnerer:
 *   empSum      – "ansattId|uke"          → total prosent
 *   projSum     – "prosjektId|uke"        → total prosent
 *   empSumSure  – "ansattId|uke"          → prosent kun for sikre (ikke usikre) timer
 *   empSumFakt  – "ansattId|uke"          → prosent for sikre + fakturerbare timer
 *   exact       – "ansattId|prosjektId|uke" → selve assignment-objektet
 *   empProj     – "ansattId"              → Map<prosjektId, Set<uker med prosent > 0>>
 *   projEmp     – "prosjektId"            → Map<ansattId, Set<uker med prosent > 0>>
 *   projektMap  – "prosjektId"            → prosjekt-objektet (for rask oppslag)
 */
function buildAssignmentIndex() {
    const empSum     = new Map();
    const projSum    = new Map();
    const empSumSure = new Map();
    const empSumFakt = new Map();
    const exact      = new Map();
    const empProj    = new Map();
    const projEmp    = new Map();

    // Bygg et raskt oppslagskart for prosjekter
    const projektMap = new Map();
    data.projects.forEach(p => projektMap.set(String(p.id), p));

    data.assignments.forEach(a => {
        const aId  = String(a.ansatt_id);
        const pId  = String(a.prosjekt_id);
        const uke  = a.uke;
        const pros = Number(a.prosent) || 0;
        const isU  = !!a.er_usikker;
        const proj = projektMap.get(pId);

        // ── Sum per ansatt per uke (alle timer) ───────────────
        const empKey = `${aId}|${uke}`;
        empSum.set(empKey, (empSum.get(empKey) || 0) + pros);

        // ── Sum for sikre timer (brukes i grafen) ─────────────
        if (!isU) {
            empSumSure.set(empKey, (empSumSure.get(empKey) || 0) + pros);

            // ── Sum for fakturerbare sikre timer ──────────────
            if (proj && !proj.er_ufakturerbart) {
                empSumFakt.set(empKey, (empSumFakt.get(empKey) || 0) + pros);
            }
        }

        // ── Sum per prosjekt per uke ──────────────────────────
        const projKey = `${pId}|${uke}`;
        projSum.set(projKey, (projSum.get(projKey) || 0) + pros);

        // ── Eksakt oppslag ────────────────────────────────────
        exact.set(`${aId}|${pId}|${uke}`, a);

        // ── Hvilke prosjekter har ansatt aktive timer på? ─────
        if (pros > 0) {
            if (!empProj.has(aId)) empProj.set(aId, new Map());
            const empMap = empProj.get(aId);
            if (!empMap.has(pId)) empMap.set(pId, new Set());
            empMap.get(pId).add(uke);

            // ── Hvilke ansatte har aktive timer på prosjekt? ──
            if (!projEmp.has(pId)) projEmp.set(pId, new Map());
            const projMap = projEmp.get(pId);
            if (!projMap.has(aId)) projMap.set(aId, new Set());
            projMap.get(aId).add(uke);
        }
    });

    return { empSum, projSum, empSumSure, empSumFakt, exact, empProj, projEmp, projektMap };
}


// =============================================================
// LAGRING TIL DATABASE
// =============================================================

/**
 * Lagrer én celleendring til Supabase.
 * Oppdaterer også data.assignments lokalt slik at UI-et ikke trenger
 * å hente data på nytt etter hvert enkelt tastetrykk.
 *
 * @param {string}  ansattId   - UUID til ansatt
 * @param {string}  prosjektId - UUID til prosjekt
 * @param {string}  uke        - f.eks. "u17/26"
 * @param {string}  inVal      - verdi fra inputfeltet, f.eks. "50" eller "30u"
 * @param {boolean} silent     - true = ikke vis "Lagret"-melding eller oppdater grafen
 */
async function save(ansattId, prosjektId, uke, inVal, silent = false) {
    const isUnsure = inVal.toLowerCase().endsWith('u');
    const val      = parseFloat(inVal.replace('u', '')) || 0;
    const id       = `${ansattId}_${prosjektId}_${uke}`;

    const { error } = await db
        .from('bemanning')
        .upsert(
            { id, ansatt_id: ansattId, prosjekt_id: prosjektId, uke, prosent: val, er_usikker: isUnsure },
            { onConflict: 'id' }
        )
        .select('id');

    if (!error) {
        // Oppdater lokal data umiddelbart
        const existing = data.assignments.find(a => String(a.id) === String(id));
        if (existing) {
            existing.prosent    = val;
            existing.er_usikker = isUnsure;
        } else {
            data.assignments.push({ id, ansatt_id: ansattId, prosjekt_id: prosjektId, uke, prosent: val, er_usikker: isUnsure });
        }

        if (!silent) {
            document.getElementById('saveStatus').innerText = "Lagret";
            setTimeout(() => { document.getElementById('saveStatus').innerText = ""; }, 800);
            renderTotaler();
            updateChart();
            updateStats();
            oppdaterLokalSum(ansattId, prosjektId, uke);
        }
    } else {
        alert("Feil ved lagring. Prøv å laste siden på nytt (F5).");
    }
}


// =============================================================
// BATCH-OPERASJONER
// =============================================================

/**
 * Fyller alle fremtidige uker i samme måned som ukeId med den gitte verdien.
 * Brukes ved dobbeltklikk i en celle eller via høyreklikkmenyen.
 */
async function fillMonth(ansattId, prosjektId, ukeId, value) {
    const trimmedValue = String(value || '').trim();
    if (trimmedValue === '') return;

    const startIdx    = data.timeline.findIndex(t => t.id === ukeId);
    const targetMonth = data.timeline[startIdx].month;

    document.getElementById('saveStatus').innerText = "Lagrer måned...";
    _batchUndoActive = true;

    const undoEntries = [];
    const promises    = [];

    for (let i = startIdx; i < data.timeline.length; i++) {
        // Stopp når vi forlater måneden
        if (data.timeline[i].month !== targetMonth) break;

        // Hopp over fortidige uker (låste celler), men ta med inneværende uke
        if (!data.timeline[i].isPast || data.timeline[i].id === currentWeekId) {
            const wk       = data.timeline[i].id;
            const existing = data.assignments.find(
                a => String(a.ansatt_id) === String(ansattId) &&
                     String(a.prosjekt_id) === String(prosjektId) &&
                     a.uke === wk
            );
            undoEntries.push({
                ansattId, prosjektId, uke: wk,
                oldValue:   existing ? existing.prosent    : 0,
                oldUsikker: existing ? existing.er_usikker : false
            });
            promises.push(save(ansattId, prosjektId, wk, trimmedValue, true));
        }
    }

    pushUndo(undoEntries);
    await Promise.all(promises);
    _batchUndoActive = false;

    document.getElementById('saveStatus').innerText = "Lagret";
    setTimeout(() => { document.getElementById('saveStatus').innerText = ""; }, 800);
    renderUI();
}

/**
 * Fyller de neste 3 månedene (et kvartal) fra ukeId med den gitte verdien.
 */
async function fillQuarter(ansattId, prosjektId, ukeId, value) {
    const trimmedValue = String(value || '').trim();
    if (trimmedValue === '') return;

    const startIdx      = data.timeline.findIndex(t => t.id === ukeId);
    const startMonth    = data.timeline[startIdx].month;
    const startMonthIdx = monthNames.indexOf(startMonth);

    // Bygg en liste med de 3 månedene som inngår i kvartalet
    const quarterMonths = [
        startMonth,
        monthNames[(startMonthIdx + 1) % 12],
        monthNames[(startMonthIdx + 2) % 12]
    ];

    document.getElementById('saveStatus').innerText = "Lagrer kvartal...";
    _batchUndoActive = true;

    const undoEntries = [];
    const promises    = [];

    for (let i = startIdx; i < data.timeline.length; i++) {
        if (!quarterMonths.includes(data.timeline[i].month)) break;

        if (!data.timeline[i].isPast || data.timeline[i].id === currentWeekId) {
            const wk       = data.timeline[i].id;
            const existing = data.assignments.find(
                a => String(a.ansatt_id) === String(ansattId) &&
                     String(a.prosjekt_id) === String(prosjektId) &&
                     a.uke === wk
            );
            undoEntries.push({
                ansattId, prosjektId, uke: wk,
                oldValue:   existing ? existing.prosent    : 0,
                oldUsikker: existing ? existing.er_usikker : false
            });
            promises.push(save(ansattId, prosjektId, wk, trimmedValue, true));
        }
    }

    pushUndo(undoEntries);
    await Promise.all(promises);
    _batchUndoActive = false;

    document.getElementById('saveStatus').innerText = "Lagret";
    setTimeout(() => { document.getElementById('saveStatus').innerText = ""; }, 800);
    renderUI();
}

/**
 * Nullstiller alle fremtidige uker i samme måned som ukeId (setter til 0).
 */
async function clearMonth(ansattId, prosjektId, ukeId) {
    const startIdx    = data.timeline.findIndex(t => t.id === ukeId);
    const targetMonth = data.timeline[startIdx].month;

    document.getElementById('saveStatus').innerText = "Tømmer måned...";
    _batchUndoActive = true;

    const undoEntries = [];
    const promises    = [];

    for (let i = startIdx; i < data.timeline.length; i++) {
        if (data.timeline[i].month !== targetMonth) break;

        if (!data.timeline[i].isPast || data.timeline[i].id === currentWeekId) {
            const wk       = data.timeline[i].id;
            const existing = data.assignments.find(
                a => String(a.ansatt_id) === String(ansattId) &&
                     String(a.prosjekt_id) === String(prosjektId) &&
                     a.uke === wk
            );
            undoEntries.push({
                ansattId, prosjektId, uke: wk,
                oldValue:   existing ? existing.prosent    : 0,
                oldUsikker: existing ? existing.er_usikker : false
            });
            promises.push(save(ansattId, prosjektId, wk, '0', true));
        }
    }

    pushUndo(undoEntries);
    await Promise.all(promises);
    _batchUndoActive = false;

    document.getElementById('saveStatus').innerText = "Tømt";
    setTimeout(() => { document.getElementById('saveStatus').innerText = ""; }, 800);
    renderUI();
}
