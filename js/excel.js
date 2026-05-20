// =============================================================
// excel.js
// Excel-eksport og -import med SheetJS (XLSX).
// Tre eksporter: fullstendig backup, prognose-pivot og prosjektliste.
// =============================================================


// =============================================================
// EKSPORT: BACKUP + PROGNOSE
// =============================================================

/**
 * Eksporterer to Excel-faner:
 *   "Backup"    – rådata fra bemanning-tabellen, klar for re-import
 *   "Prognose"  – menneskevennlig pivot med ansatte × uker
 *
 * Bruker paginering for å hente all data (omgår Supabase 1000-radersgrense).
 */
async function exportToExcel() {
    document.getElementById('saveStatus').innerText = "Eksporterer...";

    // ── Hent ansatte og prosjekter parallelt ──────────────────
    const [empRes, projRes] = await Promise.all([
        db.from('ansatte').select('*').order('navn'),
        db.from('prosjekter').select('*').order('navn')
    ]);

    // ── Hent all bemanning med paginering ─────────────────────
    // Supabase returnerer maks 1000 rader per kall, så vi looper
    let bemanningRows = [];
    let from          = 0;
    const pageSize    = 1000;

    while (true) {
        const { data: chunk, error } = await db
            .from('bemanning')
            .select('*')
            .range(from, from + pageSize - 1);

        if (error || !chunk || chunk.length === 0) break;
        bemanningRows = bemanningRows.concat(chunk);
        if (chunk.length < pageSize) break;
        from += pageSize;
    }

    if (!bemanningRows.length) {
        document.getElementById('saveStatus').innerText = "";
        return alert("Ingen data å eksportere.");
    }

    const wb = XLSX.utils.book_new();

    // ── Fane 1: Ansatte (rådata for gjenoppretting) ───────────
    const wsAnsatte = XLSX.utils.json_to_sheet(empRes.data || []);
    wsAnsatte['!cols'] = [
        { wch: 36 },  // id (UUID)
        { wch: 25 },  // navn
        { wch: 15 },  // avdeling
        { wch: 15 },  // gruppe
        { wch: 30 },  // email
        { wch: 12 }   // rolle
    ];
    XLSX.utils.book_append_sheet(wb, wsAnsatte, "Ansatte");

    // ── Fane 2: Prosjekter (rådata for gjenoppretting) ────────
    const wsProsjekter = XLSX.utils.json_to_sheet(projRes.data || []);
    wsProsjekter['!cols'] = [
        { wch: 36 },  // id (UUID)
        { wch: 12 },  // prosjektnummer
        { wch: 45 },  // navn
        { wch: 8 },   // er_nc
        { wch: 14 },  // er_ufakturerbart
        { wch: 8 }    // arkivert
    ];
    XLSX.utils.book_append_sheet(wb, wsProsjekter, "Prosjekter");

    // ── Fane 3: Bemanning (rådata for gjenoppretting) ─────────
    const wsBackup = XLSX.utils.json_to_sheet(bemanningRows);
    XLSX.utils.book_append_sheet(wb, wsBackup, "Bemanning");

    // ── Fane 4: Prognose (menneskevennlig pivot) ───────────────
    const wsPivot = _buildPrognosePivot(bemanningRows);
    XLSX.utils.book_append_sheet(wb, wsPivot, "Prognose");

    XLSX.writeFile(wb, `Nordic_Backup_${new Date().toLocaleDateString('no-NO')}.xlsx`);
    document.getElementById('saveStatus').innerText = "";
}

/**
 * Bygger pivottabellen "Prognose": ansatte i rader, uker i kolonner.
 * Inkluderer en TOTAL-rad per ansatt som summerer alle prosjekter.
 */
function _buildPrognosePivot(rows) {
    const uker = data.timeline.map(t => t.id);

    // Bygg et map: "ansattId||prosjektId" → { metadata + ukeverdier }
    const map = {};
    rows.forEach(r => {
        const key = `${r.ansatt_id}||${r.prosjekt_id}`;
        if (!map[key]) {
            const emp  = data.employees.find(e => String(e.id) === String(r.ansatt_id)) || {};
            const proj = data.projects.find(p => String(p.id) === String(r.prosjekt_id)) || {};
            map[key] = {
                avdeling:     emp.avdeling  || '',
                klynge:       emp.gruppe    || '',
                ansattNavn:   emp.navn      || 'Ukjent',
                prosjektNavn: proj.navn     || 'Ukjent'
            };
        }
        // Usikre verdier markeres med "u"-suffiks (f.eks. "50u")
        map[key][r.uke] = r.er_usikker ? (r.prosent + 'u') : r.prosent;
    });

    const header = ['Avdeling', 'Klynge', 'Ansatt', 'Prosjekt', ...uker];
    const sorted = Object.values(map).sort((a, b) =>
        a.ansattNavn.localeCompare(b.ansattNavn, 'no') ||
        a.prosjektNavn.localeCompare(b.prosjektNavn, 'no')
    );
    const ansatte = [...new Set(sorted.map(r => r.ansattNavn))];

    const finalRows = [header];

    ansatte.forEach(ansatt => {
        const blokk = sorted.filter(r => r.ansattNavn === ansatt);

        // Én rad per prosjekt
        blokk.forEach(r => finalRows.push([
            r.avdeling, r.klynge, r.ansattNavn, r.prosjektNavn,
            ...uker.map(u => r[u] ?? '')
        ]));

        // Summeringsrad for ansatt
        finalRows.push([
            '', '', ansatt, 'TOTAL',
            ...uker.map(u =>
                blokk.reduce((sum, r) =>
                    sum + (parseFloat(String(r[u] ?? '').replace('u', '')) || 0), 0
                ) || ''
            )
        ]);

        // Tom rad mellom ansatte for lesbarhet
        finalRows.push(new Array(header.length).fill(''));
    });

    const ws = XLSX.utils.aoa_to_sheet(finalRows);
    ws['!cols'] = [
        { wch: 15 },  // Avdeling
        { wch: 15 },  // Klynge
        { wch: 20 },  // Ansatt
        { wch: 40 },  // Prosjekt
        ...uker.map(() => ({ wch: 7 }))  // Uker
    ];
    return ws;
}


// =============================================================
// EKSPORT: PROSJEKTLISTE (kun synlig for admin/superbruker)
// =============================================================

/**
 * Eksporterer en prosjektliste med månedsverk per prosjekt
 * for de neste 6 månedene, samt en oppsummering med utnyttelse.
 *
 * NC-prosjekter vises øverst, Nordic-prosjekter nederst.
 * Prosjekter uten aktivitet i perioden skjules.
 */
async function exportProsjektliste() {
    document.getElementById('saveStatus').innerText = "Eksporterer prosjektliste...";

    // ── Bygg månedsliste for de neste 6 månedene ─────────────
    const currentIdx = data.timeline.findIndex(t => t.id === currentWeekId);
    const fremtid    = data.timeline.slice(currentIdx);

    const maaneder = [];
    let currentMonth = null;
    fremtid.forEach(t => {
        const key = `${t.month} ${t.year}`;
        if (key !== currentMonth) {
            maaneder.push({ label: `${t.month} ${t.year}`, uker: [t.id] });
            currentMonth = key;
        } else {
            maaneder[maaneder.length - 1].uker.push(t.id);
        }
    });
    const perioder = maaneder.slice(0, 12); // 12 måneder fremover

    // ── Bestem hvilke ansatte som teller ──────────────────────
    const valgtAvdeling  = document.getElementById('avdelingFilter').value;
    const gyldigeAnsatte = data.employees
        .filter(e => valgtAvdeling === 'Alle' || e.avdeling === valgtAvdeling)
        .map(e => e.id);
    const totalKapasitet = gyldigeAnsatte.length;

    const aktiveProsjekter = data.projects.filter(p => !p.arkivert);

    // ── Hjelpefunksjoner ──────────────────────────────────────

    // Beregner månedsverk per prosjekt per periode
    const buildRows = (prosjekter) => {
        return prosjekter
            .map(p => {
                const row = [
                    p.prosjektnummer || '',
                    p.navn,
                    p.er_nc ? 'NC' : (p.er_ufakturerbart ? 'Ufakt.' : 'Nordic')
                ];
                perioder.forEach(m => {
                    // Sum prosent for alle relevante ansatte i perioden
                    const sumProsent = data.assignments
                        .filter(a =>
                            a.prosjekt_id === p.id &&
                            m.uker.includes(a.uke) &&
                            gyldigeAnsatte.includes(a.ansatt_id)
                        )
                        .reduce((sum, a) => sum + (Number(a.prosent) || 0), 0);

                    // Konverter til månedsverk (sum / antall uker / 100%)
                    const maanedsverk = m.uker.length ? (sumProsent / m.uker.length / 100) : 0;
                    row.push(maanedsverk > 0 ? Number(maanedsverk.toFixed(2)) : '');
                });
                return row;
            })
            // Skjul prosjekter uten aktivitet i perioden
            .filter(row => row.slice(3).some(val => val !== ''));
    };

    // Beregner sumrad for en gruppe
    const lagSumRad = (tittel, rader) => {
        const sumRad = ['', tittel, 'SUM'];
        perioder.forEach((_, i) => {
            const sum = rader.reduce((acc, row) => acc + (Number(row[3 + i]) || 0), 0);
            sumRad.push(sum > 0 ? Number(sum.toFixed(2)) : 0);
        });
        return sumRad;
    };

    // ── Bygg rader per gruppe ─────────────────────────────────
    const ncRader     = buildRows(aktiveProsjekter.filter(p => p.er_nc));
    const nordicRader = buildRows(aktiveProsjekter.filter(p => !p.er_nc && !p.er_ufakturerbart));
    const ufaktRader  = buildRows(aktiveProsjekter.filter(p => p.er_ufakturerbart));

    const header = ['Nr', 'Prosjekt', 'Type', ...perioder.map(m => m.label)];
    const rows   = [header];

    if (ncRader.length > 0) {
        rows.push(['NC PROSJEKTER', '', '', ...perioder.map(() => '')]);
        rows.push(...ncRader);
        rows.push(lagSumRad('Sum NC', ncRader));
        rows.push(new Array(header.length).fill(''));
    }
    if (nordicRader.length > 0) {
        rows.push(['NORDIC PROSJEKTER', '', '', ...perioder.map(() => '')]);
        rows.push(...nordicRader);
        rows.push(lagSumRad('Sum Nordic', nordicRader));
        rows.push(new Array(header.length).fill(''));
    }
    if (ufaktRader.length > 0) {
        rows.push(['UFAKTURERBARE', '', '', ...perioder.map(() => '')]);
        rows.push(...ufaktRader);
        rows.push(lagSumRad('Sum Ufakturerbart', ufaktRader));
        rows.push(new Array(header.length).fill(''));
    }

    // ── Oppsummering ──────────────────────────────────────────
    const alleRader    = [...ncRader, ...nordicRader, ...ufaktRader];
    const totalSumRad  = lagSumRad('TOTALT PLANLAGT', alleRader);

    const kapasitetRad = ['', 'TOTAL KAPASITET', 'Mnd.verk'];
    perioder.forEach(() => kapasitetRad.push(totalKapasitet));

    const utnyttelseBrokRad = ['', 'UTNYTTELSE (brøk)', 'Mnd.verk'];
    perioder.forEach((_, i) => {
        const planlagt = totalSumRad[3 + i] || 0;
        utnyttelseBrokRad.push(`${planlagt} av ${totalKapasitet}`);
    });

    const utnyttelseProsentRad = ['', 'UTNYTTELSE (%)', '%'];
    perioder.forEach((_, i) => {
        const planlagt = totalSumRad[3 + i] || 0;
        const prosent  = totalKapasitet > 0
            ? Math.round((planlagt / totalKapasitet) * 100)
            : 0;
        utnyttelseProsentRad.push(prosent + '%');
    });

    rows.push(['OPPSUMMERING', '', '', ...perioder.map(() => '')]);
    rows.push(totalSumRad);
    rows.push(kapasitetRad);
    rows.push(utnyttelseBrokRad);
    rows.push(utnyttelseProsentRad);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
        { wch: 12 },  // Nr
        { wch: 45 },  // Prosjekt
        { wch: 10 },  // Type
        ...perioder.map(() => ({ wch: 15 }))
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Prosjektliste");
    XLSX.writeFile(wb, `Nordic_Prosjektliste_${new Date().toLocaleDateString('no-NO')}.xlsx`);
    document.getElementById('saveStatus').innerText = "";
}


// =============================================================
// IMPORT: BEMANNING (kun superbruker)
// =============================================================

/**
 * Gjenoppretter bemanning fra en backup-fil.
 * Støtter både UUID-baserte filer (nytt format) og navne-baserte filer (gammelt format).
 * Sender data i chunks på 1000 rader for å unngå timeout.
 */
async function importFromExcel(event) {
    if (currentUserRole !== 'superbruker') {
        return alert("Kun superbrukere kan gjenopprette fra backup.");
    }

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const arr = new Uint8Array(e.target.result);
        const wb  = XLSX.read(arr, { type: 'array' });

        // Sjekk om dette er en fullstendig backup (har alle tre tabellene)
        const harAnsatte    = wb.SheetNames.includes('Ansatte');
        const harProsjekter = wb.SheetNames.includes('Prosjekter');
        const harBemanning  = wb.SheetNames.includes('Bemanning');

        if (!harBemanning) {
            return alert("Fant ikke 'Bemanning'-fane i filen. Er dette en gyldig backup?");
        }

        const erFullBackup = harAnsatte && harProsjekter && harBemanning;

        const bekreft = erFullBackup
            ? "Dette er en fullstendig backup.\n\nVil du gjenopprette:\n• Ansatte\n• Prosjekter\n• Bemanning\n\nEksisterende data vil ikke slettes – kun nye rader legges til / oppdateres."
            : "Dette ser ut som en eldre backup (kun bemanning).\n\nVil du importere bemanningsdata?";

        if (!confirm(bekreft)) return;

        document.getElementById('saveStatus').innerText = "Gjenoppretter...";
        let hasError = false;
        let errMsg   = "";

        // ── 1. Gjenopprett ansatte ────────────────────────────
        if (harAnsatte) {
            const ansatte = XLSX.utils.sheet_to_json(wb.Sheets['Ansatte']);
            if (ansatte.length > 0) {
                const { error } = await db.from('ansatte').upsert(ansatte, { onConflict: 'id' });
                if (error) { hasError = true; errMsg = "Ansatte: " + error.message; }
            }
        }

        // ── 2. Gjenopprett prosjekter ─────────────────────────
        if (!hasError && harProsjekter) {
            const prosjekter = XLSX.utils.sheet_to_json(wb.Sheets['Prosjekter']);
            if (prosjekter.length > 0) {
                const { error } = await db.from('prosjekter').upsert(prosjekter, { onConflict: 'id' });
                if (error) { hasError = true; errMsg = "Prosjekter: " + error.message; }
            }
        }

        // ── 3. Gjenopprett bemanning ──────────────────────────
        if (!hasError) {
            const bemanningJson = XLSX.utils.sheet_to_json(wb.Sheets['Bemanning']);
            const chunkSize     = 1000;

            for (let i = 0; i < bemanningJson.length; i += chunkSize) {
                const { error } = await db.from('bemanning').upsert(
                    bemanningJson.slice(i, i + chunkSize),
                    { onConflict: 'id' }
                );
                if (error) { hasError = true; errMsg = "Bemanning: " + error.message; break; }
            }
        }

        if (hasError) {
            alert("Gjenoppretting feilet: " + errMsg);
            document.getElementById('saveStatus').innerText = "Feilet";
        } else {
            alert("Gjenoppretting fullført!");
            location.reload();
        }
    };
    reader.readAsArrayBuffer(file);
}


// =============================================================
// IMPORT: ANSATTE (kun superbruker)
// =============================================================

/**
 * Importerer nye ansatte fra en Excel-fil.
 * Påkrevd kolonne: "navn". Valgfrie: "avdeling", "gruppe", "email", "rolle".
 * Hopper over ansatte som allerede finnes i systemet.
 */
async function importAnsatteFromExcel(event) {
    if (currentUserRole !== 'superbruker') {
        return alert("Kun superbrukere kan importere ansatter.");
    }

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const arr  = new Uint8Array(e.target.result);
        const wb   = XLSX.read(arr, { type: 'array' });
        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

        if (!json.length) return alert("Filen er tom.");

        // Bygg header-map for case-insensitiv kolonnenavnmatching
        const headers   = Object.keys(json[0]);
        const headerMap = {};
        headers.forEach(h => { headerMap[h.toLowerCase()] = h; });

        if (!headerMap['navn']) {
            return alert("Mangler påkrevd kolonne: navn");
        }

        // ── Filtrer duplikater ────────────────────────────────
        const eksisterende = data.employees.map(e => e.navn.toLowerCase());
        const nyeAnsatte   = [];
        const duplikater   = [];

        json.forEach(row => {
            const navn = String(row[headerMap['navn']] || '').trim();
            if (!navn) return;

            if (eksisterende.includes(navn.toLowerCase())) {
                duplikater.push(navn);
                return;
            }

            const rolle = String(row[headerMap['rolle']] || '').toLowerCase();

            nyeAnsatte.push({
                navn,
                avdeling: String(row[headerMap['avdeling']] || '').trim() || null,
                gruppe:   String(row[headerMap['gruppe']]   || '').trim() || null,
                email:    String(row[headerMap['email']]    || '').trim().toLowerCase() || null,
                rolle:    ['admin', 'ansatt', 'superbruker'].includes(rolle) ? rolle : 'ansatt'
            });
        });

        if (!nyeAnsatte.length) {
            return alert(`Ingen nye ansatte å importere.\nAllerede i systemet: ${duplikater.join(', ')}`);
        }

        let bekreft = `Importerer ${nyeAnsatte.length} ansatte.`;
        if (duplikater.length) {
            bekreft += `\n\nHopper over ${duplikater.length} som allerede finnes:\n${duplikater.join(', ')}`;
        }
        if (!confirm(bekreft)) return;

        document.getElementById('saveStatus').innerText = "Importerer ansatte...";

        const { error } = await db.from('ansatte').insert(nyeAnsatte);
        if (error) {
            alert("Importfeil: " + error.message);
            document.getElementById('saveStatus').innerText = "";
        } else {
            alert(`${nyeAnsatte.length} ansatte lagt til!`);
            await fetchData();
            updateFilterDropdowns();
            renderUI();
            document.getElementById('saveStatus').innerText = "";
        }
    };
    reader.readAsArrayBuffer(file);
}