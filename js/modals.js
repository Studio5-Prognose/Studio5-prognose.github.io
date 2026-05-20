// =============================================================
// modals.js
// Åpning, lukking og lagring av alle modaler:
// prosjekter, ansatte og prosjekttildeling.
// =============================================================


// =============================================================
// PROSJEKTMODAL
// =============================================================

/** Åpner modalen for å opprette et nytt prosjekt med tomme felter. */
function openNewProjectModal() {
    document.getElementById('modalTitle').innerText    = "Nytt Prosjekt";
    document.getElementById('editProjId').value        = "";
    document.getElementById('projNo').value            = "";
    document.getElementById('projName').value          = "";
    document.getElementById('projArkivert').checked    = false;
    document.getElementById('deleteBtn').style.display = "none";

    // Skjul seksjoner som kun er relevante ved redigering
    document.getElementById('archiveSection').style.display = "none";
    document.getElementById('mergeSection').style.display   = "none";

    if (document.getElementById('projAvdeling')) document.getElementById('projAvdeling').value = "";
    if (document.getElementById('projKlynge'))   document.getElementById('projKlynge').value   = "";

    document.getElementById('projectModal').style.display = "flex";
}

/**
 * Åpner modalen for å redigere et eksisterende prosjekt.
 * Viser sammenslåings-seksjonen kun for admin/superbruker.
 */
function openEditProjectModal(id, nr, navn, isNC, isUF, isArkivert, avdeling, gruppe) {
    document.getElementById('modalTitle').innerText = "Rediger Prosjekt";
    document.getElementById('editProjId').value     = id;
    document.getElementById('projNo').value         = nr;
    document.getElementById('projName').value       = navn;
    document.getElementById('projArkivert').checked = isArkivert;

    document.querySelector(`input[name="projType"][value="${isNC ? 'nc' : (isUF ? 'uf' : 'nordic')}"]`).checked = true;

    if (document.getElementById('projAvdeling')) {
        document.getElementById('projAvdeling').value = avdeling && avdeling !== 'undefined' ? avdeling : '';
    }
    if (document.getElementById('projKlynge')) {
        document.getElementById('projKlynge').value = gruppe && gruppe !== 'undefined' ? gruppe : '';
    }

    document.getElementById('archiveSection').style.display = "block";
    document.getElementById('deleteBtn').style.display      = "block";

    // Sammenslåing er kun tilgjengelig for administratorer
    const isAdmin = currentUserRole === 'admin' || currentUserRole === 'superbruker';
    if (isAdmin) {
        document.getElementById('mergeSection').style.display = "block";
        document.getElementById('mergeTargetProject').innerHTML =
            '<option value="">-- Velg prosjekt å slå sammen med --</option>' +
            data.projects
                .filter(p => p.id !== id)
                .map(p => `<option value="${p.id}">${esc(p.navn)}</option>`)
                .join('');
    } else {
        document.getElementById('mergeSection').style.display = "none";
    }

    document.getElementById('projectModal').style.display = "flex";
}

/**
 * Lagrer et nytt eller redigert prosjekt.
 * Viser advarsel ved duplikatnavn eller -nummer.
 */
async function saveProject() {
    const id       = document.getElementById('editProjId').value;
    const nr       = document.getElementById('projNo').value.trim();
    const navn     = document.getElementById('projName').value.trim();
    const type     = document.querySelector('input[name="projType"]:checked').value;
    const arkivert = document.getElementById('projArkivert').checked;
    const avdeling = document.getElementById('projAvdeling')?.value.trim() || '';
    const gruppe   = document.getElementById('projKlynge')?.value.trim()   || '';

    if (!navn) return;

    const payload = {
        prosjektnummer:  nr,
        navn,
        avdeling:        avdeling || null,
        gruppe:          gruppe   || null,
        er_nc:           type === 'nc',
        er_ufakturerbart: type === 'uf',
        arkivert
    };

    if (id) {
        // Oppdater eksisterende prosjekt
        await db.from('prosjekter').update(payload).eq('id', id);
    } else {
        // Sjekk for duplikater før oppretting
        const checkNavn = navn.toLowerCase().replace(/\s+/g, '');
        const lignende  = data.projects.find(p =>
            (nr && p.prosjektnummer === nr) ||
            p.navn.toLowerCase().replace(/\s+/g, '') === checkNavn
        );
        if (lignende && !confirm(`Advarsel: Lignende navn ("${lignende.navn}") finnes. Fortsett?`)) return;
        await db.from('prosjekter').insert([payload]);
    }

    await fetchData();
    renderUI();
    closeModals();
}

/** Sletter et prosjekt etter bekreftelse. */
async function deleteProject() {
    if (!confirm("Slette prosjektet?")) return;
    await db.from('prosjekter').delete().eq('id', document.getElementById('editProjId').value);
    await fetchData();
    renderUI();
    closeModals();
}

/**
 * Slår to prosjekter sammen.
 * Alle timer fra det gamle prosjektet flyttes til det valgte målprosjektet.
 * Overlappende uker summeres. Det gamle prosjektet slettes deretter.
 *
 * Kan ikke angres – brukeren må bekrefte.
 */
async function executeMerge() {
    const oldId = document.getElementById('editProjId').value;
    const newId = document.getElementById('mergeTargetProject').value;

    if (!newId) return alert("Velg et prosjekt.");
    if (!confirm("Sikker? Sletter dette og flytter timer til valgt prosjekt. Kan ikke angres.")) return;

    document.getElementById('saveStatus').innerText = "Slår sammen...";

    const oldAssignments = data.assignments.filter(a => String(a.prosjekt_id) === String(oldId));
    const newAssignments = data.assignments.filter(a => String(a.prosjekt_id) === String(newId));
    const toUpsert       = [];

    oldAssignments.forEach(oldA => {
        const existing = newAssignments.find(nA =>
            String(nA.ansatt_id) === String(oldA.ansatt_id) && nA.uke === oldA.uke
        );

        if (existing) {
            // Begge prosjektene har timer for samme ansatt/uke → summer dem
            toUpsert.push({
                id:          existing.id,
                ansatt_id:   existing.ansatt_id,
                prosjekt_id: newId,
                uke:         existing.uke,
                prosent:     (Number(existing.prosent) || 0) + (Number(oldA.prosent) || 0),
                er_usikker:  !!(existing.er_usikker || oldA.er_usikker)
            });
        } else {
            // Kun gammelt prosjekt har timer → flytt direkte
            toUpsert.push({
                id:          `${oldA.ansatt_id}_${newId}_${oldA.uke}`,
                ansatt_id:   oldA.ansatt_id,
                prosjekt_id: newId,
                uke:         oldA.uke,
                prosent:     Number(oldA.prosent) || 0,
                er_usikker:  !!oldA.er_usikker
            });
        }
    });

    // Upsert i chunks for å unngå timeout
    if (toUpsert.length > 0) {
        for (let i = 0; i < toUpsert.length; i += 1000) {
            const { error } = await db.from('bemanning').upsert(
                toUpsert.slice(i, i + 1000),
                { onConflict: 'id' }
            );
            if (error) {
                document.getElementById('saveStatus').innerText = "";
                return alert("Feil under flytting av timer: " + error.message);
            }
        }
    }

    // Slett gamle rader og selve prosjektet
    const { error: delErr } = await db.from('bemanning').delete().eq('prosjekt_id', oldId);
    if (delErr) {
        document.getElementById('saveStatus').innerText = "";
        return alert("Feil under sletting av gamle timer: " + delErr.message);
    }

    const { error: projErr } = await db.from('prosjekter').delete().eq('id', oldId);
    if (projErr) {
        document.getElementById('saveStatus').innerText = "";
        return alert("Feil under sletting av prosjekt: " + projErr.message);
    }

    document.getElementById('saveStatus').innerText = "Ferdig!";
    setTimeout(() => { document.getElementById('saveStatus').innerText = ""; }, 1500);
    await fetchData();
    renderUI();
    closeModals();
}


// =============================================================
// ANSATTMODAL
// =============================================================

/** Åpner modalen for å opprette en ny ansatt. */
function openNewEmployeeModal() {
    document.getElementById('editEmpId').value    = "";
    document.getElementById('editEmpName').value  = "";
    document.getElementById('editEmpAvdeling').value = "";
    document.getElementById('editEmpKlynge').value   = "";
    document.getElementById('editEmpEmail').value    = "";
    document.getElementById('editEmpRole').value     = "ansatt";
    document.getElementById('employeeModal').style.display = 'flex';
}

/** Åpner modalen for å redigere en eksisterende ansatt. */
function openEditEmployeeModal(id, navn, avdeling, klynge, epost, rolle) {
    document.getElementById('editEmpId').value    = id;
    document.getElementById('editEmpName').value  = navn;
    document.getElementById('editEmpAvdeling').value = avdeling && avdeling !== 'undefined' ? avdeling : '';
    document.getElementById('editEmpKlynge').value   = klynge   && klynge   !== 'undefined' ? klynge   : '';
    document.getElementById('editEmpEmail').value    = epost    && epost    !== 'undefined' ? epost    : '';
    document.getElementById('editEmpRole').value     = rolle    && rolle    !== 'undefined' ? rolle    : 'ansatt';
    document.getElementById('employeeModal').style.display = 'flex';
}

/**
 * Lagrer en ny eller redigert ansatt.
 * Sjekker for duplikatnavn ved opprettelse.
 */
async function saveEmployee() {
    const id       = document.getElementById('editEmpId').value;
    const navn     = document.getElementById('editEmpName').value.trim();
    const avdeling = document.getElementById('editEmpAvdeling').value.trim();
    const klynge   = document.getElementById('editEmpKlynge').value.trim();
    const epost    = document.getElementById('editEmpEmail').value.trim().toLowerCase();
    const rolle    = document.getElementById('editEmpRole').value;

    if (!navn) return;

    if (id) {
        await db.from('ansatte')
            .update({ navn, avdeling, gruppe: klynge, email: epost, rolle })
            .eq('id', id);
    } else {
        if (data.employees.find(e => e.navn.toLowerCase() === navn.toLowerCase())) {
            return alert("En ansatt med dette navnet finnes allerede!");
        }
        await db.from('ansatte').insert([{ navn, avdeling, gruppe: klynge, email: epost, rolle }]);
    }

    await fetchData();
    updateFilterDropdowns();
    renderUI();
    closeModals();
}

/**
 * Fjerner alle bemanningsrader for en ansatt på et prosjekt.
 * Brukes via ×-knappen på prosjektrader.
 */
async function removeProjectFromEmployee(ansattId, prosjektId) {
    if (!confirm("Fjerne prosjektet fra ansatt? Alle timer slettes.")) return;
    await db.from('bemanning').delete().eq('ansatt_id', ansattId).eq('prosjekt_id', prosjektId);
    await fetchData();
    renderUI();
}


// =============================================================
// TILDELINGSMODAL
// =============================================================

/**
 * Åpner modalen for å legge til et prosjekt på en ansatt.
 * @param {string} ansattId - UUID til ansatt
 */
function openAssignModal(ansattId) {
    activeAssigneeId = ansattId;
    document.getElementById('projectSearch').value    = "";
    document.getElementById('assignModal').style.display = 'flex';
    filterProjects();
}

/**
 * Filtrer prosjektlisten i tildelingsmodalen basert på søketekst.
 * Viser kun ikke-arkiverte prosjekter.
 */
function filterProjects() {
    const sok  = document.getElementById('projectSearch').value.toLowerCase();
    const list = document.getElementById('projectList');
    list.innerHTML = '';

    data.projects
        .filter(p => p.navn.toLowerCase().includes(sok) && !p.arkivert)
        .forEach(p => {
            const div = document.createElement('div');
            div.style.padding = "10px";
            div.style.cursor  = "pointer";
            div.textContent   = p.navn;

            div.onclick = async () => {
                // Legg til med 0% slik at raden vises med en gang
                nyligLagtTil.add(`${activeAssigneeId}_${p.id}`);
                await save(activeAssigneeId, p.id, currentWeekId, '0');
                closeModals();
                renderUI();
                setTimeout(scrollToCurrentWeek, 100);
            };

            list.appendChild(div);
        });
}


// =============================================================
// FELLES
// =============================================================

/** Lukker alle åpne modaler. */
function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => {
        m.style.display = 'none';
    });
}
