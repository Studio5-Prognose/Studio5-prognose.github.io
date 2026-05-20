// =============================================================
// ui.js
// Tegning av tabell, totaler og cellevisning.
// =============================================================


// =============================================================
// DUAL SCROLLBAR
// Viser en ekstra scrollbar øverst i tabellen slik at man kan
// scrolle horisontalt uten å måtte dra til bunnen av siden.
// =============================================================

let _dualScrollBound = false; // Sikrer at event-lyttere kun bindes én gang
let _activeScroller  = null;  // "top" | "main" | null – hvem scrollet sist?

function getScrollRatio(el) {
    const max = el.scrollWidth - el.clientWidth;
    return max > 0 ? el.scrollLeft / max : 0;
}

function setScrollRatio(el, ratio) {
    const max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = ratio * max;
}

function syncTopFromMain() {
    const scrollTop  = document.getElementById('scrollTop');
    const scrollMain = document.getElementById('mainTableContainer');
    if (scrollTop && scrollMain) {
        setScrollRatio(scrollTop, getScrollRatio(scrollMain));
    }
}

/**
 * Setter opp den øverste scrollbaren og synkroniserer den med
 * hoved-scrollbaren. Kalles etter at tabellen er tegnet.
 */
function setupDualScrollbar() {
    const scrollTop      = document.getElementById('scrollTop');
    const scrollMain     = document.getElementById('mainTableContainer');
    const scrollTopInner = document.getElementById('scrollTopInner');
    if (!scrollTop || !scrollMain || !scrollTopInner) return;

    const table = scrollMain.querySelector('table');
    if (table) scrollTopInner.style.width = table.scrollWidth + 'px';

    if (_dualScrollBound) return;
    _dualScrollBound = true;

    scrollTop.addEventListener('pointerdown', () => { _activeScroller = 'top'; });
    scrollTop.addEventListener('wheel',       () => { _activeScroller = 'top'; });
    scrollMain.addEventListener('pointerdown', () => { _activeScroller = 'main'; });
    scrollMain.addEventListener('wheel',       () => { _activeScroller = 'main'; });
    window.addEventListener('pointerup',       () => { _activeScroller = null; });

    scrollTop.addEventListener('scroll', () => {
        if (_activeScroller === 'main') return;
        setScrollRatio(scrollMain, getScrollRatio(scrollTop));
    });
    scrollMain.addEventListener('scroll', () => {
        if (_activeScroller === 'top') return;
        setScrollRatio(scrollTop, getScrollRatio(scrollMain));
    });
}


// =============================================================
// HOVED-RENDERUI
// =============================================================

/**
 * Tegner hele tabellen på nytt basert på gjeldende tilstand.
 * Støtter visningene: "ansatte", "ledig", "fravær" og "prosjekter".
 *
 * Bruker buildAssignmentIndex() for å unngå millioner av .filter()-kall.
 */
function renderUI() {
    updateFilterDropdowns(false);

    const view           = document.getElementById('viewFilter').value;
    const avdelingSelect = document.getElementById('avdelingFilter');
    const klyngeSelect   = document.getElementById('klyngeFilter');

    document.getElementById('chartSection').style.display = 'block';
    document.getElementById('statsSection').style.display = view === 'prosjekter' ? 'grid' : 'none';
    avdelingSelect.style.display = 'inline-block';
    klyngeSelect.style.display   = (avdelingSelect.value === 'Alle' || klyngeSelect.options.length <= 1)
        ? 'none' : 'inline-block';

    const prosjektSokEl = document.getElementById('prosjektSok');
    if (prosjektSokEl) {
    prosjektSokEl.style.display = 'inline-block';
    prosjektSokEl.placeholder = view === 'prosjekter'
        ? 'Søk på prosjektnavn eller nr...'
        : 'Søk på ansattnavn...';
    }

    // Bygg ytelsesindeks én gang for hele renderingen
    const idx = buildAssignmentIndex();

    // Finn fraværsprosjektet (brukes i fravær-visningen)
    const fraværProj = data.projects.find(p =>
        p.navn.toLowerCase().includes('fravær') ||
        p.navn.toLowerCase().includes('ferie')
    );
    const fraværId = fraværProj ? String(fraværProj.id) : null;

    _renderTableHeaders();

    const body = document.getElementById('tableBody');
    body.innerHTML = '';

    if (view === 'ansatte' || view === 'ledig' || view === 'fravær') {
        _renderEmployeeView(view, idx, fraværId, body);
    } else {
        _renderProjectView(idx, body);
    }

    renderTotaler(idx);
    updateChart(idx);
    updateStats();
    setTimeout(setupDualScrollbar, 0);
}

/**
 * Tegner de tre header-radene: år, måned og ukenummer.
 */
function _renderTableHeaders() {
    const head = document.getElementById('tableHead');

    let yrs = '<th class="name-col header-year"></th>';
    let mos = '<th class="name-col header-month">Navn</th>';
    let wks = '<th class="name-col header-week"></th>';

    let curY = data.timeline[0].year,  yC = 0;
    let curM = data.timeline[0].month, mC = 0;

    data.timeline.forEach((t, i) => {
        const isCur = t.id === currentWeekId;
        wks += `<th class="header-week ${isCur ? 'current-week' : ''}" data-week-id="${esc(t.id)}">U${t.week}</th>`;

        if (t.year === curY) { yC++; } else { yrs += `<th colspan="${yC}" class="header-year">${curY}</th>`; curY = t.year; yC = 1; }
        if (t.month === curM) { mC++; } else { mos += `<th colspan="${mC}" class="header-month">${esc(curM)}</th>`; curM = t.month; mC = 1; }

        if (i === data.timeline.length - 1) {
            yrs += `<th colspan="${yC}" class="header-year">${curY}</th>`;
            mos += `<th colspan="${mC}" class="header-month">${esc(t.month)}</th>`;
        }
    });

    head.innerHTML = `<tr>${yrs}</tr><tr>${mos}</tr><tr>${wks}</tr>`;
}

/**
 * Tegner ansatt-, ledig- eller fraværsvisning.
 *
 * "fravær"-visningen er en spesialmodus som viser kun fraværstimer
 * (fra et prosjekt som heter "fravær" eller "ferie") per ansatt per uke,
 * med blå fargegradering og uten ekspandering.
 */
function _renderEmployeeView(view, idx, fraværId, body) {
    const sok = document.getElementById('prosjektSok')?.value.toLowerCase() || '';
const filtrerte = getFilteredEmployees().filter(e =>
    !sok || e.navn.toLowerCase().includes(sok)
);
filtrerte.forEach(emp => {
        const tr = document.createElement('tr');
        const isFravar = view === 'fravær';

        tr.className    = isFravar ? 'row-project' : 'row-summary';
        tr.dataset.empId = emp.id;

        // Fraværsvisning kan ikke ekspanderes
        if (!isFravar) {
            tr.onclick = (e) => {
                if (e.target.closest('button')) return;
                expanded.has(emp.id) ? expanded.delete(emp.id) : expanded.add(emp.id);
                renderUI();
            };
        }

        const orgTekst  = [emp.avdeling, emp.gruppe].filter(Boolean).join(' / ') || 'Ingen avdeling';
        const canEdit   = (currentUserRole === 'admin' || currentUserRole === 'superbruker') || emp.id === currentUserId;
        const isAdmin   = currentUserRole === 'admin' || currentUserRole === 'superbruker';
        const editBtnHtml = isAdmin
            ? `<button class="edit-btn"
                    data-emp-id="${esc(emp.id)}"
                    data-emp-navn="${esc(emp.navn)}"
                    data-emp-avd="${esc(emp.avdeling)}"
                    data-emp-kly="${esc(emp.gruppe)}"
                    data-emp-epost="${esc(emp.email)}"
                    data-emp-role="${esc(emp.rolle)}"
                    data-action="edit-emp">✎</button>`
            : '';

        // Navnekolonne – fraværsvisning har ikke ekspander-pil
        let h = isFravar
            ? `<td class="name-col"><div class="name-content"><div class="name-row-top">${esc(emp.navn)} ${editBtnHtml}</div><div class="name-sub">${esc(orgTekst)}</div></div></td>`
            : `<td class="name-col"><div class="name-content"><div class="name-row-top"><span>${expanded.has(emp.id) ? '▼' : '▶'}</span> ${esc(emp.navn)} ${editBtnHtml}</div><div class="name-sub">${esc(orgTekst)}</div></div></td>`;

        data.timeline.forEach(t => {
            if (isFravar) {
                // ── Fraværsvisning: vis kun fraværstimer med blå fargegradering ──
                if (!fraværId) {
                    h += `<td class="cell-locked" title="Fant ikke prosjekt med navn fravær eller ferie">-</td>`;
                } else {
                    const a      = idx.exact.get(`${emp.id}|${fraværId}|${t.id}`);
                    const v      = a ? a.prosent    : 0;
                    const isU    = a ? a.er_usikker : false;
                    const bgStyle = v > 0 ? `background-color:${getFravaerColor(v)}; color:#1e3a8a;` : '';
                    const past   = t.isPast && t.id !== currentWeekId;

                    if (past || !canEdit) {
                        h += `<td class="cell-locked" style="${bgStyle}">${formatCellValue(v, isU)}</td>`;
                    } else {
                        h += `<td class="${isU ? 'cell-unsure' : ''}" style="${bgStyle}" title="Høyreklikk for meny">
                                  <input class="cell-input"
                                         style="${bgStyle}"
                                         value="${formatCellValue(v, isU)}"
                                         data-ansatt-id="${esc(emp.id)}"
                                         data-prosjekt-id="${esc(fraværId)}"
                                         data-uke="${esc(t.id)}"
                                         data-action="cell-input">
                              </td>`;
                    }
                }
            } else {
                // ── Normal visning: ansatte eller ledig ───────────────────────
                const sum = idx.empSum.get(`${emp.id}|${t.id}`) || 0;
                const id  = safeId('sum_emp', emp.id, t.id);

                if (view === 'ledig') {
                    const l = 100 - sum;
                    h += `<td id="${id}"
                              style="background-color:${getLedigColor(l)};
                                     color:${l < 0 ? '#f87171' : (l === 0 ? 'transparent' : 'inherit')}">
                              ${l === 0 ? '' : l + '%'}
                          </td>`;
                } else {
                    h += `<td id="${id}"
                              style="background-color:${getCellColor(sum)};
                                     color:${sum > 0 ? 'inherit' : 'transparent'}">
                              ${sum > 0 ? sum + '%' : '-'}
                          </td>`;
                }
            }
        });

        tr.innerHTML = h;
        body.appendChild(tr);

        // Ekspanderte prosjektrader (kun i ansatte-visning)
        if (!isFravar && expanded.has(emp.id)) {
            _renderEmployeeProjects(emp, canEdit, idx, body);
        }
    });
}

/**
 * Tegner prosjektradene under en ekspandert ansatt.
 */
function _renderEmployeeProjects(emp, canEdit, idx, body) {
    const currentIdx = data.timeline.findIndex(t => t.id === currentWeekId);
    const sjekkUker  = new Set(data.timeline.slice(Math.max(0, currentIdx - 6)).map(t => t.id));
    const isAdmin    = currentUserRole === 'admin' || currentUserRole === 'superbruker';

    const empProsjMap    = idx.empProj.get(String(emp.id)) || new Map();
    const alleProsjekter = [...empProsjMap.keys()].sort((a, b) => {
        const pA = idx.projektMap.get(String(a));
        const pB = idx.projektMap.get(String(b));
        if (!pA || !pB) return 0;
        if (pA.er_ufakturerbart !== pB.er_ufakturerbart) return pA.er_ufakturerbart ? 1 : -1;
        return pA.navn.localeCompare(pB.navn, 'no');
    });

    alleProsjekter
        .filter(pId => {
            const ukeSet = empProsjMap.get(String(pId));
            if (ukeSet) for (const u of ukeSet) if (sjekkUker.has(u)) return true;
            return nyligLagtTil.has(`${emp.id}_${pId}`);
        })
        .forEach(pId => {
            const pDb = idx.projektMap.get(String(pId));
            if (!pDb) return;

            const ptr = document.createElement('tr');
            ptr.className = 'row-project';

            const rmBtnHtml = isAdmin
                ? `<button class="remove-proj-btn"
                           data-ansatt-id="${esc(emp.id)}"
                           data-prosjekt-id="${esc(pId)}"
                           data-action="remove-proj">×</button>`
                : '';

            const typeKlasse = pDb.er_nc ? 'nc-tag' : (pDb.er_ufakturerbart ? 'uf-tag' : '');
            const prosjektNr = pDb.prosjektnummer ? esc(pDb.prosjektnummer) + ' - ' : '';

            let ph = `<td class="name-col" style="padding-left:30px;">
                          <div class="name-row-top">
                              <span class="${typeKlasse}">${prosjektNr}${esc(pDb.navn)}</span>
                              ${rmBtnHtml}
                          </div>
                      </td>`;

            data.timeline.forEach(t => {
                const a    = idx.exact.get(`${emp.id}|${pId}|${t.id}`);
                const v    = a ? a.prosent    : 0;
                const isU  = a ? a.er_usikker : false;
                const past = t.isPast && t.id !== currentWeekId;

                if (past || !canEdit) {
                    ph += `<td class="cell-locked">${formatCellValue(v, isU)}</td>`;
                } else {
                    ph += `<td class="${isU ? 'cell-unsure' : ''}" title="Høyreklikk for meny">
                               <input class="cell-input"
                                      value="${formatCellValue(v, isU)}"
                                      data-ansatt-id="${esc(emp.id)}"
                                      data-prosjekt-id="${esc(pId)}"
                                      data-uke="${esc(t.id)}"
                                      data-action="cell-input">
                           </td>`;
                }
            });

            ptr.innerHTML = ph;
            body.appendChild(ptr);
        });

    if (canEdit) {
        const addRow = document.createElement('tr');
        addRow.innerHTML = `
            <td class="name-col" style="background:var(--tr-add);">
                <button data-ansatt-id="${esc(emp.id)}"
                        data-action="add-proj"
                        style="font-size:10px; margin-left:20px;
                               background:transparent; border:none;
                               color:var(--text); cursor:pointer;">
                    + Legg til prosjekt
                </button>
            </td>
            <td colspan="${data.timeline.length}"></td>`;
        body.appendChild(addRow);
    }
}

/**
 * Tegner prosjektvisning.
 */
function _renderProjectView(idx, body) {
    const valgtAvdeling = document.getElementById('avdelingFilter').value;
    const valgtKlynge  = document.getElementById('klyngeFilter').value;
    const sok          = document.getElementById('prosjektSok')
        ? document.getElementById('prosjektSok').value.toLowerCase()
        : '';
    const isAdmin = currentUserRole === 'admin' || currentUserRole === 'superbruker';

    const sorterteProsjekter = [...data.projects]
        .filter(p => valgtAvdeling === 'Alle' || p.avdeling === valgtAvdeling)
        .filter(p => valgtKlynge  === 'Alle' || p.gruppe   === valgtKlynge)
        .filter(p => !sok || p.navn.toLowerCase().includes(sok) ||
                     (p.prosjektnummer && p.prosjektnummer.toLowerCase().includes(sok)))
        .sort((a, b) => {
            if (a.er_ufakturerbart !== b.er_ufakturerbart) return a.er_ufakturerbart ? 1 : -1;
            if (a.er_nc !== b.er_nc)                        return a.er_nc ? 1 : -1;
            return a.navn.localeCompare(b.navn, 'no');
        });

    sorterteProsjekter.forEach(p => {
        const tr = document.createElement('tr');
        tr.className      = 'row-summary';
        tr.dataset.projId = p.id;
        tr.onclick = () => { expanded.has(p.id) ? expanded.delete(p.id) : expanded.add(p.id); renderUI(); };

        const editBtnHtml = isAdmin
            ? `<button class="edit-btn"
                    data-proj-id="${esc(p.id)}"
                    data-proj-nr="${esc(p.prosjektnummer)}"
                    data-proj-navn="${esc(p.navn)}"
                    data-proj-nc="${p.er_nc}"
                    data-proj-uf="${p.er_ufakturerbart}"
                    data-proj-ark="${p.arkivert}"
                    data-proj-avd="${esc(p.avdeling)}"
                    data-proj-kly="${esc(p.gruppe)}"
                    data-action="edit-proj">✎</button>`
            : '';

        const typeKlasse  = p.er_nc ? 'nc-tag' : (p.er_ufakturerbart ? 'uf-tag' : '');
        const prosjektNr  = p.prosjektnummer ? esc(p.prosjektnummer) + ' ' : '';
        const arkivertTag = p.arkivert ? ' (Arkivert)' : '';

        let h = `<td class="name-col">
                     <div class="name-row-top">
                         <span>${expanded.has(p.id) ? '▼' : '▶'}</span>
                         <span class="${typeKlasse}">${prosjektNr}${esc(p.navn)}${arkivertTag}</span>
                         ${editBtnHtml}
                     </div>
                 </td>`;

        data.timeline.forEach(t => {
            const s  = idx.projSum.get(`${p.id}|${t.id}`) || 0;
            const id = safeId('sum_proj', p.id, t.id);
            h += `<td id="${id}"
                      style="background-color:${getCellColor(s)};
                             color:${s > 0 ? 'inherit' : 'transparent'}">
                      ${s > 0 ? s + '%' : '-'}
                  </td>`;
        });

        tr.innerHTML = h;
        body.appendChild(tr);

        if (expanded.has(p.id)) {
            _renderProjectEmployees(p, idx, body);
        }
    });
}

/**
 * Tegner ansattradene under et ekspandert prosjekt.
 */
function _renderProjectEmployees(p, idx, body) {
    const currentIdx    = data.timeline.findIndex(t => t.id === currentWeekId);
    const sjekkUker     = new Set(data.timeline.slice(Math.max(0, currentIdx - 6)).map(t => t.id));
    const projAnsattMap = idx.projEmp.get(String(p.id)) || new Map();
    const alleAnsatte   = [...projAnsattMap.keys()];

    alleAnsatte
        .filter(aId => {
            const ukeSet = projAnsattMap.get(String(aId));
            if (ukeSet) for (const u of ukeSet) if (sjekkUker.has(u)) return true;
            return nyligLagtTil.has(`${aId}_${p.id}`);
        })
        .forEach(aId => {
            const empDb = data.employees.find(e => String(e.id) === String(aId));
            if (!empDb) return;

            const ptr = document.createElement('tr');
            ptr.className = 'row-project';

            const canEditRow = (currentUserRole === 'admin' || currentUserRole === 'superbruker') ||
                               String(aId) === String(currentUserId);

            let ph = `<td class="name-col" style="padding-left:30px;">${esc(empDb.navn)}</td>`;

            data.timeline.forEach(t => {
                const a    = idx.exact.get(`${aId}|${p.id}|${t.id}`);
                const v    = a ? a.prosent    : 0;
                const isU  = a ? a.er_usikker : false;
                const past = t.isPast && t.id !== currentWeekId;

                if (past || !canEditRow) {
                    ph += `<td class="cell-locked">${formatCellValue(v, isU)}</td>`;
                } else {
                    ph += `<td class="${isU ? 'cell-unsure' : ''}">
                               <input class="cell-input"
                                      value="${formatCellValue(v, isU)}"
                                      data-ansatt-id="${esc(aId)}"
                                      data-prosjekt-id="${esc(p.id)}"
                                      data-uke="${esc(t.id)}"
                                      data-action="cell-input">
                           </td>`;
                }
            });

            ptr.innerHTML = ph;
            body.appendChild(ptr);
        });
}


// =============================================================
// TOTALRAD
// =============================================================

/**
 * Tegner totalraden i tabellfoten.
 * Støtter alle fire visninger: ansatte, ledig, fravær og prosjekter.
 */
function renderTotaler(idx) {
    const view = document.getElementById('viewFilter').value;
    const foot = document.getElementById('tableFoot');

    if (view === 'prosjekter') { foot.innerHTML = ''; return; }

    if (!idx) idx = buildAssignmentIndex();

    const fEmps = getFilteredEmployees();

    // Finn fraværsprosjektet for fravær-visningen
    const fraværProj = data.projects.find(p =>
        p.navn.toLowerCase().includes('fravær') ||
        p.navn.toLowerCase().includes('ferie')
    );
    const fraværId = fraværProj ? String(fraværProj.id) : null;

    const tittel = view === 'ledig' ? 'SNITT LEDIG'
                 : view === 'fravær' ? 'SNITT FRAVÆR'
                 : 'TOTAL UTNYTTELSE';

    let h = `<tr class="row-total"><td class="name-col">${tittel}</td>`;

    data.timeline.forEach(t => {
        let total = 0;

        if (view === 'fravær') {
            // Sum kun fraværstimer
            if (fraværId) {
                fEmps.forEach(e => {
                    const a = idx.exact.get(`${e.id}|${fraværId}|${t.id}`);
                    if (a) total += Number(a.prosent);
                });
            }
        } else {
            fEmps.forEach(e => { total += idx.empSum.get(`${e.id}|${t.id}`) || 0; });
        }

        const avg = Math.round(total / (fEmps.length || 1));
        const id  = safeId('total', t.id);

        if (view === 'ledig') {
            const l = 100 - avg;
            h += `<td id="${id}"
                      style="background-color:${getLedigColor(l)};
                             color:${l < 0 ? '#f87171' : (l === 0 ? 'transparent' : 'inherit')}">
                      ${l === 0 ? '' : l + '%'}
                  </td>`;
        } else if (view === 'fravær') {
            const bg = getFravaerColor(avg);
            h += `<td id="${id}"
                      style="background-color:${bg};
                             color:${avg > 0 ? '#1e3a8a' : 'transparent'}">
                      ${avg > 0 ? avg + '%' : '-'}
                  </td>`;
        } else {
            h += `<td id="${id}"
                      style="background-color:${getCellColor(avg)};
                             color:${avg > 0 ? 'inherit' : 'transparent'}">
                      ${avg}%
                  </td>`;
        }
    });

    foot.innerHTML = h + '</tr>';
}


// =============================================================
// ØYEBLIKKELIG OPPDATERING AV ENKELTCELLER
// =============================================================

/**
 * Oppdaterer sammendragsraden og totalraden for én uke uten full re-render.
 */
function oppdaterLokalSum(ansattId, prosjektId, uke) {
    const view = document.getElementById('viewFilter').value;
    let targetCell;

    if (view === 'ansatte' || view === 'ledig') {
        const row       = document.querySelector(`tr.row-summary[data-emp-id="${ansattId}"]`);
        const weekIndex = data.timeline.findIndex(t => String(t.id) === String(uke));
        if (row && weekIndex >= 0 && row.cells[weekIndex + 1]) targetCell = row.cells[weekIndex + 1];
        else targetCell = findIdCell('sum_emp', ansattId, uke);
        if (!targetCell) return;

        const nySum = data.assignments
            .filter(a => String(a.ansatt_id) === String(ansattId) && String(a.uke) === String(uke))
            .reduce((s, a) => s + (Number(a.prosent) || 0), 0);

        if (view === 'ledig') {
            const ledig = 100 - nySum;
            targetCell.style.backgroundColor = getLedigColor(ledig);
            targetCell.textContent            = ledig === 0 ? '' : ledig + '%';
            targetCell.style.color            = ledig < 0 ? '#f87171' : 'inherit';
        } else {
            targetCell.style.backgroundColor = getCellColor(nySum);
            targetCell.textContent           = nySum > 0 ? nySum + '%' : '-';
            targetCell.style.color           = nySum > 100 ? '#f87171' : 'inherit';
        }
    } else if (view === 'prosjekter') {
        const row       = document.querySelector(`tr.row-summary[data-proj-id="${prosjektId}"]`);
        const weekIndex = data.timeline.findIndex(t => String(t.id) === String(uke));
        if (row && weekIndex >= 0 && row.cells[weekIndex + 1]) targetCell = row.cells[weekIndex + 1];
        else targetCell = findIdCell('sum_proj', prosjektId, uke);
        if (!targetCell) return;

        const nySum = data.assignments
            .filter(a => String(a.prosjekt_id) === String(prosjektId) && String(a.uke) === String(uke))
            .reduce((s, a) => s + (Number(a.prosent) || 0), 0);

        targetCell.style.backgroundColor = getCellColor(nySum);
        targetCell.textContent           = nySum > 0 ? nySum + '%' : '-';
        targetCell.style.color           = nySum > 0 ? 'inherit' : 'transparent';
    }
    // Fraværsvisning: sammendragsraden er ikke en sum-rad, hopp over

    // Oppdater totalraden i footer
    const fEmps     = getFilteredEmployees();
    const totalCell = findIdCell('total', uke);
    if (!totalCell || fEmps.length === 0) return;

    const total = fEmps.reduce((sum, e) => {
        return sum + data.assignments
            .filter(a => String(a.ansatt_id) === String(e.id) && String(a.uke) === String(uke))
            .reduce((s, a) => s + (Number(a.prosent) || 0), 0);
    }, 0);
    const avg = Math.round(total / fEmps.length);

    if (view === 'ledig') {
        const l = 100 - avg;
        totalCell.style.backgroundColor = getLedigColor(l);
        totalCell.textContent           = l === 0 ? '' : l + '%';
        totalCell.style.color           = l < 0 ? '#f87171' : 'inherit';
    } else {
        totalCell.style.backgroundColor = getCellColor(avg);
        totalCell.textContent           = avg + '%';
        totalCell.style.color           = avg > 0 ? 'inherit' : 'transparent';
    }
}


// =============================================================
// STATISTIKK
// =============================================================

function updateStats() {
    const fakturerbare = data.projects.filter(p => !p.er_ufakturerbart && !p.arkivert);
    const nc           = fakturerbare.filter(p => p.er_nc);
    document.getElementById('statNordicCount').innerText = fakturerbare.length - nc.length;
    document.getElementById('statNC').innerText          = nc.length;
    document.getElementById('statPercNC').innerText      = fakturerbare.length > 0
        ? Math.round((nc.length / fakturerbare.length) * 100) + '%'
        : '0%';
}
