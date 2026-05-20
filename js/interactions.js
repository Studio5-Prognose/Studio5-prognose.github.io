// =============================================================
// interactions.js
// Alle brukerinteraksjoner: celleredigering, tastatur, undo,
// drag-markering, piltastnavigering og høyreklikkmenyen.
// =============================================================


// =============================================================
// ANGRE (UNDO)
// =============================================================

/**
 * Legger en liste med angre-entries på stacken.
 * entries: [{ ansattId, prosjektId, uke, oldValue, oldUsikker }]
 */
function pushUndo(entries) {
    undoStack.push(entries);
    if (undoStack.length > MAX_UNDO) undoStack.shift(); // Fjern eldste ved overflow
}

function showToast(msg) {
    const el = document.createElement('div');
    el.className   = 'undo-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

/**
 * Angrer siste operasjon fra undo-stacken.
 * Gjenoppretter alle celler som inngikk i operasjonen.
 */
async function performUndo() {
    if (!undoStack.length) { showToast('Ingenting å angre'); return; }

    const entries = undoStack.pop();
    document.getElementById('saveStatus').innerText = "Angrer...";

    // Gjenopprett alle celler parallelt
    const promises = entries.map(e => {
        const valStr = e.oldValue > 0
            ? String(e.oldValue) + (e.oldUsikker ? 'u' : '')
            : '0';
        return save(e.ansattId, e.prosjektId, e.uke, valStr, true);
    });

    await Promise.all(promises);

    document.getElementById('saveStatus').innerText = "Angret";
    setTimeout(() => { document.getElementById('saveStatus').innerText = ""; }, 800);

    renderUI();
    showToast(`Angret ${entries.length} ${entries.length === 1 ? 'celle' : 'celler'}`);
}


// =============================================================
// HØYREKLIKKMENYEN
// =============================================================

let contextMenuEl = null;

function createContextMenu() {
    if (contextMenuEl) return;

    contextMenuEl = document.createElement('div');
    contextMenuEl.className    = 'context-menu';
    contextMenuEl.style.display = 'none';
    contextMenuEl.innerHTML = `
        <div class="context-menu-item" data-ctx="fill-month">📅 Fyll måned</div>
        <div class="context-menu-item" data-ctx="fill-quarter">📊 Fyll kvartal</div>
        <div class="context-menu-sep"></div>
        <div class="context-menu-item danger" data-ctx="clear-month">🗑 Tøm måned</div>
    `;
    document.body.appendChild(contextMenuEl);

    // Skjul menyen ved klikk utenfor eller scroll
    document.addEventListener('click',  () => hideContextMenu());
    document.addEventListener('scroll', () => hideContextMenu(), true);
}

function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.style.display = 'none';
}

/**
 * Viser høyreklikkmenyen ved musepekeren.
 * Justerer posisjonen automatisk hvis menyen ville gå utenfor skjermen.
 */
function showContextMenu(x, y, ansattId, prosjektId, uke, currentValue) {
    createContextMenu();

    contextMenuEl.style.left    = x + 'px';
    contextMenuEl.style.top     = y + 'px';
    contextMenuEl.style.display = 'block';

    // Juster posisjon hvis menyen går utenfor viewporten
    const rect = contextMenuEl.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  contextMenuEl.style.left = (x - rect.width)  + 'px';
    if (rect.bottom > window.innerHeight) contextMenuEl.style.top  = (y - rect.height) + 'px';

    // Fjern gamle lyttere ved å erstatte elementer (unngår doble klikk)
    contextMenuEl.querySelectorAll('.context-menu-item').forEach(item => {
        const clone = item.cloneNode(true);
        item.parentNode.replaceChild(clone, item);
    });

    contextMenuEl.querySelector('[data-ctx="fill-month"]').addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        fillMonth(ansattId, prosjektId, uke, currentValue);
    });
    contextMenuEl.querySelector('[data-ctx="fill-quarter"]').addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        fillQuarter(ansattId, prosjektId, uke, currentValue);
    });
    contextMenuEl.querySelector('[data-ctx="clear-month"]').addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        clearMonth(ansattId, prosjektId, uke);
    });
}


// =============================================================
// INITIALISERING AV LYTTERE
// =============================================================

/**
 * Setter opp alle event-lyttere for tabellen og globale hurtigtaster.
 * Kalles én gang ved oppstart (fra main.js).
 *
 * Bruker delegert event-håndtering på container-nivå der det er mulig,
 * slik at lyttere overlever re-rendering av tbody.
 */
function initListeners() {
    // Oppdater klynge-dropdown automatisk ved filterendringer
    document.getElementById('viewFilter').addEventListener('change', () => updateFilterDropdowns(false));
    document.getElementById('avdelingFilter').addEventListener('change', () => updateFilterDropdowns(false));

    const container = document.getElementById('mainTableContainer');

    // ── Klikk på knapper i tabellen ───────────────────────────
    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        e.stopPropagation();

        switch (btn.dataset.action) {
            case 'edit-emp':
                openEditEmployeeModal(
                    btn.dataset.empId,
                    btn.dataset.empNavn,
                    btn.dataset.empAvd,
                    btn.dataset.empKly,
                    btn.dataset.empEpost,
                    btn.dataset.empRole
                );
                break;
            case 'edit-proj':
                openEditProjectModal(
                    btn.dataset.projId,
                    btn.dataset.projNr,
                    btn.dataset.projNavn,
                    btn.dataset.projNc  === 'true',
                    btn.dataset.projUf  === 'true',
                    btn.dataset.projArk === 'true',
                    btn.dataset.projAvd,
                    btn.dataset.projKly
                );
                break;
            case 'remove-proj':
                await removeProjectFromEmployee(btn.dataset.ansattId, btn.dataset.prosjektId);
                break;
            case 'add-proj':
                openAssignModal(btn.dataset.ansattId);
                break;
        }
    });

    // ── Høyreklikk: vis kontekstmenyen ────────────────────────
    container.addEventListener('contextmenu', (e) => {
        const inp = e.target.closest('input[data-action="cell-input"]');
        if (!inp) return;
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, inp.dataset.ansattId, inp.dataset.prosjektId, inp.dataset.uke, inp.value);
    });

    // ── Celleredigering ───────────────────────────────────────
    // handleCellUpdate kjøres ved input, change og blur.
    // Vi bruker capture-fasen (true) for å fange opp events
    // fra alle input-felter i dokumentet, ikke bare i containeren.

    window.addEventListener('input',  (e) => {
        if (e.target.tagName === 'INPUT' && e.target.dataset.action === 'cell-input') {
            handleCellUpdate(e.target);
        }
    }, true);

    window.addEventListener('change', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.dataset.action === 'cell-input') {
            handleCellUpdate(e.target);
        }
    }, true);

    window.addEventListener('blur', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.dataset.action === 'cell-input') {
            handleCellUpdate(e.target);
        }
    }, true);

    // ── Drag-markering ────────────────────────────────────────
    _setupDragSelection(container);

    // ── Tastaturnavigering og hurtigtaster ────────────────────
    _setupKeyboardHandlers();
}


// =============================================================
// CELLEREDIGERING
// =============================================================

/**
 * Håndterer én celleendring.
 * Oppdaterer lokal tilstand umiddelbart for responsiv feedback,
 * og debouncer faktisk lagring til Supabase med 500ms forsinkelse.
 *
 * Undo-entry lagres kun når debounce-timeren faktisk fyrer,
 * slik at rask innskriving ikke fyller opp undo-stacken.
 */
function handleCellUpdate(inp) {
    if (!inp) return;

    const aId = inp.dataset.ansattId;
    const pId = inp.dataset.prosjektId;
    const uke = inp.dataset.uke;
    const id  = `${aId}_${pId}_${uke}`;

    const valStr = String(inp.value).toLowerCase().trim();
    const isU    = valStr.endsWith('u');
    const val    = parseFloat(valStr.replace('u', '')) || 0;

    // Oppdater visuell usikker-styling umiddelbart
    const td = inp.closest('td');
    if (td) {
        if (isU) td.classList.add('cell-unsure');
        else     td.classList.remove('cell-unsure');
    }

    // Finn eksisterende rad i lokal data
    const existing = data.assignments.find(a =>
        String(a.ansatt_id)   === String(aId) &&
        String(a.prosjekt_id) === String(pId) &&
        String(a.uke)         === String(uke)
    );

    // Lagre original-verdi kun ved første endring (ikke ved hvert tastetrykk)
    if (!pendingSaves[id]) {
        pendingSaves[id] = {
            ansattId:   aId, prosjektId: pId, uke,
            value:      inp.value,
            origValue:  existing ? existing.prosent    : 0,
            origUsikker: existing ? existing.er_usikker : false
        };
    } else {
        pendingSaves[id].value = inp.value;
    }

    // Oppdater lokal data umiddelbart (uten å vente på Supabase)
    if (existing) {
        existing.prosent    = val;
        existing.er_usikker = isU;
    } else {
        data.assignments.push({
            id, ansatt_id: aId, prosjekt_id: pId, uke,
            prosent: val, er_usikker: isU
        });
    }

    // Oppdater kun de berørte cellene (ikke hele tabellen)
    oppdaterLokalSum(aId, pId, uke);

    // Debounce: vent 500ms etter siste tastetrykk før lagring
    clearTimeout(saveTimeouts[id]);
    saveTimeouts[id] = setTimeout(async () => {
        const orig = pendingSaves[id];
        if (orig && !_batchUndoActive) {
            pushUndo([{
                ansattId:   aId, prosjektId: pId, uke,
                oldValue:   orig.origValue,
                oldUsikker: orig.origUsikker
            }]);
        }
        delete pendingSaves[id];
        await save(aId, pId, uke, inp.value, true);
    }, 500);
}


// =============================================================
// DRAG-MARKERING
// =============================================================

/**
 * Setter opp drag-markering for å velge flere celler på én gang.
 * Brukeren kan dra over celler med musen, eller holde Shift for å utvide valget.
 * Etter markering kan man trykke Enter for å kopiere en verdi til alle,
 * eller Delete/Backspace for å nullstille alle markerte celler.
 */
function _setupDragSelection(container) {
    let isDragging    = false;
    let selectedCells = new Set();

    const clearSelection = () => {
        selectedCells.forEach(inp => inp.classList.remove('selected-cell'));
        selectedCells.clear();
    };

    const addToSelection = (inp) => {
        if (!selectedCells.has(inp)) {
            selectedCells.add(inp);
            inp.classList.add('selected-cell');
        }
    };

    container.addEventListener('mousedown', (e) => {
        const inp = e.target.closest('input[data-action="cell-input"]');
        if (!inp) return;

        if (e.shiftKey) {
            // Shift+klikk: legg til i eksisterende markering
            e.preventDefault();
            addToSelection(inp);
            return;
        }

        // Start ny markering
        isDragging = true;
        clearSelection();
        addToSelection(inp);

        // Firefox-fix: stopper standard tekstmarkering som ellers "stjeler" musen
        // og blokkerer mouseover-events under dragging.
        e.preventDefault();

        // Siden vi blokkerte standardoppførselen, må vi sette fokus manuelt
        inp.focus();
        inp.select();
    });

    // 'mouseover' er mer stabilt enn 'mousemove' for å oppdage cellegrenser
    container.addEventListener('mouseover', (e) => {
        if (!isDragging || e.buttons !== 1) return; // Kun ved venstreknapp nede
        const inp = e.target.closest('input[data-action="cell-input"]');
        if (inp) addToSelection(inp);
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    // Fjern markering ved klikk utenfor tabellen
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#mainTableContainer') && selectedCells.size > 0) {
            clearSelection();
        }
    });

    // Eksponerer selectedCells til tastatur-handleren
    container._selectedCells = selectedCells;
    container._clearSelection = clearSelection;
    container._addToSelection = addToSelection;
}


// =============================================================
// TASTATUR
// =============================================================

/**
 * Setter opp globale tastaturlyttere:
 *   Ctrl+Z / Cmd+Z  – angre
 *   Enter           – kopier verdi til alle markerte celler
 *   Delete/Backspace – slett alle markerte celler
 *   Piltaster       – naviger mellom celler
 */
function _setupKeyboardHandlers() {
    const container   = document.getElementById('mainTableContainer');

    window.addEventListener('keydown', (e) => {
        const selectedCells = container._selectedCells || new Set();
        const clearSelection = container._clearSelection || (() => {});

        // ── Ctrl+Z / Cmd+Z: angre ─────────────────────────────
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            // Ikke interferer med undo i vanlige tekstfelter
            if (e.target.tagName === 'INPUT' && e.target.dataset.action !== 'cell-input') return;
            e.preventDefault();
            performUndo();
            return;
        }

        // Resten gjelder kun cell-input
        const isCellInput = e.target.tagName === 'INPUT' && e.target.dataset.action === 'cell-input';

        if (!isCellInput) {
            _handleArrowNavigation(e);
            return;
        }

        const isEnter  = e.key === 'Enter';
        const isDelete = e.key === 'Delete' ||
                         (e.key === 'Backspace' && selectedCells.size > 1 && selectedCells.has(e.target));

        if (isEnter) {
            e.target.blur();

            if (selectedCells.has(e.target) && selectedCells.size > 1) {
                // Enter med flere celler markert: kopier aktivt felt til alle
                const val = e.target.value;
                _batchUndoActive = true;
                const undoEntries = [];

                selectedCells.forEach(inp => {
                    const ex = data.assignments.find(a =>
                        String(a.ansatt_id)   === String(inp.dataset.ansattId) &&
                        String(a.prosjekt_id) === String(inp.dataset.prosjektId) &&
                        a.uke                 === inp.dataset.uke
                    );
                    undoEntries.push({
                        ansattId:   inp.dataset.ansattId,
                        prosjektId: inp.dataset.prosjektId,
                        uke:        inp.dataset.uke,
                        oldValue:   ex ? ex.prosent    : 0,
                        oldUsikker: ex ? ex.er_usikker : false
                    });
                    inp.value = val;
                    handleCellUpdate(inp);
                });

                pushUndo(undoEntries);
                _batchUndoActive = false;
                clearSelection();
            } else {
                handleCellUpdate(e.target);
            }

        } else if (isDelete) {
            // Delete/Backspace med flere celler markert: nullstill alle
            e.preventDefault();
            _batchUndoActive = true;
            const undoEntries = [];

            selectedCells.forEach(inp => {
                const ex = data.assignments.find(a =>
                    String(a.ansatt_id)   === String(inp.dataset.ansattId) &&
                    String(a.prosjekt_id) === String(inp.dataset.prosjektId) &&
                    a.uke                 === inp.dataset.uke
                );
                undoEntries.push({
                    ansattId:   inp.dataset.ansattId,
                    prosjektId: inp.dataset.prosjektId,
                    uke:        inp.dataset.uke,
                    oldValue:   ex ? ex.prosent    : 0,
                    oldUsikker: ex ? ex.er_usikker : false
                });
                inp.value = '';
                handleCellUpdate(inp);
            });

            pushUndo(undoEntries);
            _batchUndoActive = false;

        } else {
            _handleArrowNavigation(e);
        }

    }, true); // capture: true for å fange events tidlig
}

/**
 * Navigerer mellom celler med piltastene.
 * Opp/ned bytter rad, venstre/høyre bytter celle i samme rad.
 */
function _handleArrowNavigation(e) {
    const active = document.activeElement;
    if (!active) return;
    if (!['INPUT', 'SELECT'].includes(active.tagName)) return;
    if (!active.closest('#tableBody')) return;

    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(e.key)) return;

    const row       = active.closest('tr');
    const cell      = active.closest('td, th');
    if (!row || !cell) return;

    const cellIndex = Array.from(row.children).indexOf(cell);
    const rows      = Array.from(document.querySelectorAll('#tableBody tr'));
    const rowIndex  = rows.indexOf(row);

    let targetInput;

    if (e.key === 'ArrowRight') {
        const inputs = Array.from(row.querySelectorAll('input, select'));
        targetInput  = inputs[inputs.indexOf(active) + 1];
    } else if (e.key === 'ArrowLeft') {
        const inputs = Array.from(row.querySelectorAll('input, select'));
        targetInput  = inputs[inputs.indexOf(active) - 1];
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const targetRow = rows[rowIndex + 1];
        if (targetRow?.children[cellIndex]) {
            targetInput = targetRow.children[cellIndex].querySelector('input, select');
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const targetRow = rows[rowIndex - 1];
        if (targetRow?.children[cellIndex]) {
            targetInput = targetRow.children[cellIndex].querySelector('input, select');
        }
    }

    if (targetInput) {
    const c = document.getElementById('mainTableContainer');
    if (c._clearSelection)  c._clearSelection();
    if (c._addToSelection)  c._addToSelection(targetInput);
    targetInput.focus();
    if (targetInput.select) targetInput.select();
}

}
