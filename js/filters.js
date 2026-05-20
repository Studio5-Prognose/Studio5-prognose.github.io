// =============================================================
// filters.js
// Filtrering av ansatte og prosjekter, og oppdatering av
// avdeling/klynge-dropdowns i verktøylinjen.
// =============================================================


/**
 * Oppdaterer avdeling- og klynge-dropdowns basert på valgt visning.
 *
 * Klynge-listen avhenger av valgt avdeling – velger du "Alle avdelinger"
 * vises alle klynger, velger du én avdeling vises bare klyngene der.
 *
 * I prosjektvisning hentes klynger fra prosjekter (ikke ansatte),
 * siden prosjekter kan ha egne avdelinger/klynger.
 *
 * @param {boolean} resetAvdelinger - true = bygg avdelingslisten på nytt
 */
function updateFilterDropdowns(resetAvdelinger = true) {
    const view      = document.getElementById('viewFilter').value;
    const avdFilter = document.getElementById('avdelingFilter');
    const klyFilter = document.getElementById('klyngeFilter');

    // Lagre gjeldende valg så vi kan gjenopprette dem etter oppdatering
    const currentAvd = avdFilter.value;
    const currentKly = klyFilter.value;

    // ── Avdelinger ───────────────────────────────────────────
    if (resetAvdelinger) {
        // Hent avdelinger fra både ansatte og prosjekter
        const alleAvdelinger = [
            ...data.employees.map(e => e.avdeling),
            ...data.projects.map(p => p.avdeling)
        ];
        const avdelinger = [...new Set(alleAvdelinger.filter(Boolean))].sort();

        avdFilter.innerHTML =
            '<option value="Alle">Alle Avdelinger</option>' +
            avdelinger.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');

        avdFilter.value = currentAvd || 'Alle';
    }

    // ── Klynger (avhenger av valgt avdeling og visning) ──────
    const activeAvd = avdFilter.value;
    let alleKlynger = [];

    if (view === 'prosjekter') {
        // I prosjektvisning: klynger fra prosjekter
        const relevante = activeAvd === 'Alle'
            ? data.projects
            : data.projects.filter(p => p.avdeling === activeAvd);
        alleKlynger = relevante.map(p => p.gruppe);
    } else {
        // I ansatt-/ledigvisning: klynger fra ansatte
        const relevante = activeAvd === 'Alle'
            ? data.employees
            : data.employees.filter(e => e.avdeling === activeAvd);
        alleKlynger = relevante.map(e => e.gruppe);
    }

    const klynger = [...new Set(alleKlynger.filter(Boolean))].sort();

    klyFilter.innerHTML =
        '<option value="Alle">Alle Klynger</option>' +
        klynger.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');

    // Gjenopprett forrige klyngevalg hvis det fortsatt finnes
    if (activeAvd === 'Alle') {
        klyFilter.value = 'Alle';
    } else if (klynger.includes(currentKly)) {
        klyFilter.value = currentKly;
    } else {
        klyFilter.value = 'Alle';
    }
}


/**
 * Returnerer ansatte som matcher gjeldende avdeling- og klyngefilter.
 */
function getFilteredEmployees() {
    const aF = document.getElementById('avdelingFilter').value;
    const kF = document.getElementById('klyngeFilter').value;

    return data.employees.filter(e =>
        (aF === 'Alle' || e.avdeling === aF) &&
        (kF === 'Alle' || e.gruppe   === kF)
    );
}
