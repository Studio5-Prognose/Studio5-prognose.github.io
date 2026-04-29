// =============================================================
// KONFIGURASJON & THEME
// =============================================================
console.log('Script loaded');

// Sjekk lagret tema. Hvis ingen verdi finnes, kan vi f.eks. anta mørkt er standard.
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.documentElement.classList.add('light-mode');
} else {
    document.documentElement.classList.remove('light-mode');
}

function toggleTheme() {
    const isLight = document.documentElement.classList.toggle('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    
    if (chartInstance) updateChart(); // Oppdaterer fargene på grafen
}

        const supabaseUrl = 'https://gtebkasmqdvqhwesqkcq.supabase.co';
        const supabaseKey = 'sb_publishable_fh-IwZS8DpRwwU_ETq7yZg_QvezjZe5';
        const db = supabase.createClient(supabaseUrl, supabaseKey);

        let data = { employees: [], projects: [], assignments: [], timeline: [] };
        let expanded = new Set();
        let nyligLagtTil = new Set(); 
        let chartInstance = null;
        let activeAssigneeId = null; 
        let currentWeekId = "";
        
        let currentUserEmail = "";
        let currentUserId = "";
        let currentUserRole = "ansatt";

        function esc(str) {
            return String(str ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function safeId(...parts) {
            return parts.map(part => String(part).replace(/[^a-zA-Z0-9_-]/g, '_')).join('_');
        }

        function findIdCell(prefix, ...parts) {
            const normalized = safeId(prefix, ...parts);
            return document.getElementById(normalized) || document.getElementById([prefix, ...parts].join('_'));
        }

        // AUTH
        async function checkUser() {
            const { data: { session } } = await db.auth.getSession();
            if (session) { 
                currentUserEmail = session.user.email;
                document.getElementById('login-screen').style.display = 'none'; 
                document.getElementById('main-content').style.display = 'block'; 
                init(); 
            }
            else { document.getElementById('login-screen').style.display = 'flex'; }
        }
        async function handleLogin() {
            const email = document.getElementById('email').value.trim().toLowerCase();
            const password = document.getElementById('password').value;
            const { error } = await db.auth.signInWithPassword({ email, password });
            if (error) document.getElementById('login-error').innerText = "Feil e-post eller passord."; else location.reload();
        }
        async function handleLogout() { await db.auth.signOut(); location.reload(); }
        async function changePassword() {
            const ny = prompt("Nytt passord (minst 6 tegn):");
            if (ny && ny.length >= 6) { const { error } = await db.auth.updateUser({ password: ny }); alert(error ? error.message : "Oppdatert!"); }
        }

        // TIDSREGNING & FERIER
        const monthNames = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

        function getHolidays(year) {
            const a = year % 19, b = Math.floor(year / 100), c = year % 100;
            const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
            const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
            const m = Math.floor((a + 11 * h + 22 * l) / 451);
            const pMonth = Math.floor((h + l - 7 * m + 114) / 31) - 1; 
            const pDay = ((h + l - 7 * m + 114) % 31) + 1;
            const easterDate = new Date(year, pMonth, pDay - 3, 12, 0, 0);
            const easterWeek = getISOWeekInfo(easterDate).week;

            return { 8: "Vinterferie", [easterWeek]: "Påskeferie", 28: "Sommerferie", 29: ".", 30: ".", 31: "Sommerferie", 40: "Høstferie", 52: "Juleferie" };
        }

        function getISOWeekInfo(date) {
            const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
            const day = d.getDay() || 7;
            d.setDate(d.getDate() + 4 - day); 
            const year = d.getFullYear();
            const month = d.getMonth();
            const startOfYear = new Date(year, 0, 1, 12, 0, 0);
            const week = Math.ceil((((d - startOfYear) / 86400000) + 1) / 7);
            return { week, year, month }; 
        }

        function buildTimeline() {
            const now = new Date();
            now.setHours(12, 0, 0, 0);
            
            const currentDay = now.getDay() || 7;
            const currentMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - currentDay + 1, 12, 0, 0);
            const startMonday = new Date(currentMonday.getFullYear(), currentMonday.getMonth(), currentMonday.getDate() - (12 * 7), 12, 0, 0);

            const currentInfo = getISOWeekInfo(now);
            currentWeekId = `u${currentInfo.week}/${currentInfo.year.toString().slice(-2)}`;

            data.timeline = []; 
            for (let i = 0; i < 64; i++) {
                const d = new Date(startMonday.getFullYear(), startMonday.getMonth(), startMonday.getDate() + (i * 7), 12, 0, 0);
                const info = getISOWeekInfo(d);
                const id = `u${info.week}/${info.year.toString().slice(-2)}`;
                data.timeline.push({ id: id, week: info.week, month: monthNames[info.month], year: info.year, isPast: d < currentMonday && id !== currentWeekId });
            }
        }

        function scrollToCurrentWeek() {
            const container = document.getElementById('mainTableContainer');
            const currentWeekEl = document.querySelector(`th[data-week-id="${currentWeekId}"]`);
            if (container && currentWeekEl) {
                const scrollPos = currentWeekEl.offsetLeft - 280;
                container.scrollTo({ left: Math.max(0, scrollPos), behavior: 'smooth' });
            }
        }

        async function init() { 
            buildTimeline(); 
            await fetchData(); 
            
            const avdFilter = document.getElementById('avdelingFilter');
            const avdelinger = [...new Set(data.employees.map(e => e.avdeling).filter(Boolean))].sort();
            avdFilter.innerHTML = '<option value="Alle">Alle Avdelinger</option>' + avdelinger.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');

            const meg = data.employees.find(e => e.email && e.email.toLowerCase() === currentUserEmail.toLowerCase());
            if (meg) {
                currentUserId = meg.id;
                currentUserRole = meg.rolle || 'ansatt';
                if (meg.avdeling) avdFilter.value = meg.avdeling;
            }

            document.getElementById('admin-tools').style.display = currentUserRole === 'admin' ? 'flex' : 'none';
            updateFilterDropdowns(false); 

            if (meg && meg.gruppe) document.getElementById('klyngeFilter').value = meg.gruppe;

            initListeners();
            renderUI(); 
            setTimeout(scrollToCurrentWeek, 500);
        }

        async function fetchData() { 
            const [emp, proj] = await Promise.all([
                db.from('ansatte').select('*').order('navn'), 
                db.from('prosjekter').select('*').order('navn')
            ]);
            data.employees = emp.data || []; 
            data.projects = proj.data || [];

            let allAssignments = [];
            let from = 0;
            const pageSize = 1000;
            while (true) {
                const { data: rows, error } = await db.from('bemanning').select('*').range(from, from + pageSize - 1);
                if (error || !rows || rows.length === 0) break;
                allAssignments = allAssignments.concat(rows);
                if (rows.length < pageSize) break;
                from += pageSize;
            }
            data.assignments = allAssignments;
        }

        function updateFilterDropdowns(resetAvdelinger = true) {
            const avdFilter = document.getElementById('avdelingFilter');
            const klyFilter = document.getElementById('klyngeFilter');
            const currentAvd = avdFilter.value;
            const currentKly = klyFilter.value;

            if (resetAvdelinger) {
                const avdelinger = [...new Set(data.employees.map(e => e.avdeling).filter(Boolean))].sort();
                avdFilter.innerHTML = '<option value="Alle">Alle Avdelinger</option>' + avdelinger.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
                avdFilter.value = currentAvd || 'Alle';
            }

            const activeAvd = avdFilter.value;
            const relevantEmployees = activeAvd === 'Alle' ? data.employees : data.employees.filter(e => e.avdeling === activeAvd);
            const klynger = [...new Set(relevantEmployees.map(e => e.gruppe).filter(Boolean))].sort();
            
            klyFilter.innerHTML = '<option value="Alle">Alle Klynger</option>' + klynger.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
            
            if (activeAvd === 'Alle') klyFilter.value = 'Alle';
            else if (klynger.includes(currentKly)) klyFilter.value = currentKly;
            else klyFilter.value = 'Alle';
        }

        function getFilteredEmployees() {
            const aF = document.getElementById('avdelingFilter').value;
            const kF = document.getElementById('klyngeFilter').value;
            return data.employees.filter(e => (aF === 'Alle' || e.avdeling === aF) && (kF === 'Alle' || e.gruppe === kF));
        }

        function getCellColor(v) {
            if (!v || v === 0) return "transparent";
            if (v > 100) return "rgba(239, 68, 68, 0.35)"; 
            if (v >= 90) return "rgba(34, 197, 94, 0.35)"; 
            return `rgba(234, 179, 8, ${Math.max(0.15, (v / 90) * 0.35)})`;
        }

        function getLedigColor(v) {
            if (v <= 0) return "rgba(34, 197, 94, 0.35)"; 
            if (v <= 50) return "rgba(234, 179, 8, 0.35)"; 
            return "rgba(239, 68, 68, 0.35)"; 
        }

        // EXCEL EKSPORT & IMPORT MED ID
        async function exportProsjektliste() {
            document.getElementById('saveStatus').innerText = "Eksporterer prosjektliste...";

            const currentIdx = data.timeline.findIndex(t => t.id === currentWeekId);
            const fremtid = data.timeline.slice(currentIdx);
            
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
            const tre = maaneder.slice(0, 6); // Satt til 6 måneder

            const aktiveProsjekter = data.projects.filter(p => !p.arkivert);

            const valgtAvdeling = document.getElementById('avdelingFilter').value;
            const gyldigeAnsatte = data.employees
                .filter(e => valgtAvdeling === 'Alle' || e.avdeling === valgtAvdeling)
                .map(e => e.id);
            
            const totalKapasitet = gyldigeAnsatte.length; // Totalt antall hoder

            const buildRows = (prosjekter) => {
                return prosjekter.map(p => {
                    const row = [
                        p.prosjektnummer || '',
                        p.navn,
                        p.er_nc ? 'NC' : (p.er_ufakturerbart ? 'Ufakt.' : 'Nordic')
                    ];
                    tre.forEach(m => {
                        const sumProsent = data.assignments
                            .filter(a => a.prosjekt_id === p.id && m.uker.includes(a.uke) && gyldigeAnsatte.includes(a.ansatt_id))
                            .reduce((sum, a) => sum + (Number(a.prosent) || 0), 0);
                        
                        const maanedsverk = m.uker.length ? (sumProsent / m.uker.length / 100) : 0;
                        row.push(maanedsverk > 0 ? Number(maanedsverk.toFixed(2)) : '');
                    });
                    return row;
                }).filter(row => row.slice(3).some(val => val !== '')); 
            };

            // Hjelpefunksjon for å lage summeringsrader
            const lagSumRad = (tittel, rader) => {
                const sumRad = ['', tittel, 'SUM'];
                tre.forEach((_, idx) => {
                    const sum = rader.reduce((acc, row) => acc + (Number(row[3 + idx]) || 0), 0);
                    sumRad.push(sum > 0 ? Number(sum.toFixed(2)) : 0);
                });
                return sumRad;
            };

            const ncProsjekter = aktiveProsjekter.filter(p => p.er_nc);
            const nordicProsjekter = aktiveProsjekter.filter(p => !p.er_nc && !p.er_ufakturerbart);
            const ufaktProsjekter = aktiveProsjekter.filter(p => p.er_ufakturerbart);

            const ncRader = buildRows(ncProsjekter);
            const nordicRader = buildRows(nordicProsjekter);
            const ufaktRader = buildRows(ufaktProsjekter);

            const header = ['Nr', 'Prosjekt', 'Type', ...tre.map(m => m.label)];
            const rows = [header];

            if (ncRader.length > 0) {
                rows.push(['NC PROSJEKTER', '', '', ...tre.map(() => '')]);
                rows.push(...ncRader);
                rows.push(lagSumRad('Sum NC', ncRader));
                rows.push(new Array(header.length).fill(''));
            }

            if (nordicRader.length > 0) {
                rows.push(['NORDIC PROSJEKTER', '', '', ...tre.map(() => '')]);
                rows.push(...nordicRader);
                rows.push(lagSumRad('Sum Nordic', nordicRader));
                rows.push(new Array(header.length).fill(''));
            }

            if (ufaktRader.length > 0) {
                rows.push(['UFAKTURERBARE', '', '', ...tre.map(() => '')]);
                rows.push(...ufaktRader);
                rows.push(lagSumRad('Sum Ufakturerbart', ufaktRader));
                rows.push(new Array(header.length).fill(''));
            }

            // OPPSUMMERING NEDERST
            const alleRader = [...ncRader, ...nordicRader, ...ufaktRader];
            const totalSumRad = lagSumRad('TOTALT PLANLAGT', alleRader);
            
            const kapasitetRad = ['', 'TOTAL KAPASITET', 'Mnd.verk'];
            tre.forEach(() => kapasitetRad.push(totalKapasitet));

            const utnyttelseBrokRad = ['', 'UTNYTTELSE (brøk)', 'Mnd.verk'];
            tre.forEach((_, idx) => {
                const planlagt = totalSumRad[3 + idx] || 0;
                utnyttelseBrokRad.push(`${planlagt} av ${totalKapasitet}`);
            });

            const utnyttelseProsentRad = ['', 'UTNYTTELSE (%)', '%'];
            tre.forEach((_, idx) => {
                const planlagt = totalSumRad[3 + idx] || 0;
                const prosent = totalKapasitet > 0 ? Math.round((planlagt / totalKapasitet) * 100) : 0;
                utnyttelseProsentRad.push(prosent + '%');
            });

            rows.push(['OPPSUMMERING', '', '', ...tre.map(() => '')]);
            rows.push(totalSumRad);
            rows.push(kapasitetRad);
            rows.push(utnyttelseBrokRad);
            rows.push(utnyttelseProsentRad);

            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{ wch: 12 }, { wch: 45 }, { wch: 10 }, ...tre.map(() => ({ wch: 15 }))];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Prosjektliste");
            XLSX.writeFile(wb, `Nordic_Prosjektliste_${new Date().toLocaleDateString('no-NO')}.xlsx`);
            document.getElementById('saveStatus').innerText = "";
        }

        async function exportToExcel() {
            document.getElementById('saveStatus').innerText = "Eksporterer...";

            // Paginering – samme som fetchData()
            let rows = [];
            let from = 0;
            const pageSize = 1000;
            while (true) {
                const { data: chunk, error } = await db.from('bemanning').select('*').range(from, from + pageSize - 1);
                if (error || !chunk || chunk.length === 0) break;
                rows = rows.concat(chunk);
                if (chunk.length < pageSize) break;
                from += pageSize;
            }

            if (!rows.length) { 
                document.getElementById('saveStatus').innerText = ""; 
                return alert("Ingen data å eksportere."); 
            }

            const wb = XLSX.utils.book_new();

            // ── Fane 1: Rådata / backup ──────────────────────────────────────
            const wsBackup = XLSX.utils.json_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, wsBackup, "Backup");

            // ── Fane 2: Menneskevennlig prognose-tabell ──────────────────────
            const uker = data.timeline.map(t => t.id);
            const map = {};

            rows.forEach(r => {
                const key = `${r.ansatt_id}||${r.prosjekt_id}`;
                if (!map[key]) {
                    const emp = data.employees.find(e => String(e.id) === String(r.ansatt_id)) || {};
                    const proj = data.projects.find(p => String(p.id) === String(r.prosjekt_id)) || {};
                    map[key] = { 
                        avdeling: emp.avdeling || '', 
                        klynge: emp.gruppe || '', 
                        ansattNavn: emp.navn || 'Ukjent', 
                        prosjektNavn: proj.navn || 'Ukjent'
                    };
                }
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
                blokk.forEach(r => finalRows.push([
                    r.avdeling, r.klynge, r.ansattNavn, r.prosjektNavn, 
                    ...uker.map(u => r[u] ?? '')
                ]));
                // Sum-rad per ansatt
                finalRows.push(['', '', ansatt, 'TOTAL', ...uker.map(u =>
                    blokk.reduce((sum, r) => sum + (parseFloat(String(r[u] ?? '').replace('u', '')) || 0), 0) || ''
                )]);
                finalRows.push(new Array(header.length).fill(''));
            });

            const wsPivot = XLSX.utils.aoa_to_sheet(finalRows);
            wsPivot['!cols'] = [
                { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 40 }, 
                ...uker.map(() => ({ wch: 7 }))
            ];
            XLSX.utils.book_append_sheet(wb, wsPivot, "Prognose");

            XLSX.writeFile(wb, `Nordic_Prognose_${new Date().toLocaleDateString('no-NO')}.xlsx`);
            document.getElementById('saveStatus').innerText = "";
        }

        async function importFromExcel(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                const arr = new Uint8Array(e.target.result);
                const wb = XLSX.read(arr, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                document.getElementById('saveStatus').innerText = "Importerer...";
                
                const mappedData = [];
                for(let row of json) {
                    if(row.ansatt_id && row.prosjekt_id) { mappedData.push(row); continue; } 
                    const eDb = data.employees.find(x => x.navn === row.Ansatt);
                    const pDb = data.projects.find(x => x.navn === row.Prosjekt);
                    if(eDb && pDb) {
                        for(let key in row) {
                            if(key.startsWith('u')) {
                                const val = String(row[key]);
                                mappedData.push({
                                    id: `${eDb.id}_${pDb.id}_${key}`,
                                    ansatt_id: eDb.id, prosjekt_id: pDb.id, uke: key,
                                    prosent: parseFloat(val.replace('u','')) || 0,
                                    er_usikker: val.includes('u')
                                });
                            }
                        }
                    }
                }

                const chunkSize = 1000;
                let hasError = false; let errMsg = "";
                for (let i = 0; i < mappedData.length; i += chunkSize) {
                    const chunk = mappedData.slice(i, i + chunkSize);
                    const { error } = await db.from('bemanning').upsert(chunk);
                    if (error) { hasError = true; errMsg = error.message; break; }
                }

                if (hasError) { alert("Importfeil: " + errMsg); document.getElementById('saveStatus').innerText = "Feilet"; } 
                else { alert("Import fullført!"); location.reload(); }
            };
            reader.readAsArrayBuffer(file);
        }

        async function save(ansattId, prosjektId, uke, inVal, silent = false) {
            const isUnsure = inVal.toLowerCase().endsWith('u');
            const val = parseFloat(inVal.replace('u', '')) || 0;
            const id = `${ansattId}_${prosjektId}_${uke}`;

            const { error } = await db.from('bemanning').upsert({ id: id, ansatt_id: ansattId, prosjekt_id: prosjektId, uke: uke, prosent: val, er_usikker: isUnsure }, { onConflict: 'id' }).select('id');

            if (!error) {
                const ex = data.assignments.find(a => String(a.id) === String(id));
                if (ex) { ex.prosent = val; ex.er_usikker = isUnsure; } 
                else data.assignments.push({ id, ansatt_id: ansattId, prosjekt_id: prosjektId, uke, prosent: val, er_usikker: isUnsure });
                
                if (!silent) {
                    document.getElementById('saveStatus').innerText = "Lagret";
                    setTimeout(() => document.getElementById('saveStatus').innerText = "", 800);
                    renderTotaler(); updateChart(); updateStats();
                    oppdaterLokalSum(ansattId, prosjektId, uke);
                }
            } else { alert("Feil ved lagring. Prøv å laste siden på nytt (F5)."); }
        }

        async function fillMonth(ansattId, prosjektId, ukeId, value) {
            const currentIdx = data.timeline.findIndex(t => t.id === ukeId);
            const currentMonth = data.timeline[currentIdx].month;
            document.getElementById('saveStatus').innerText = "Lagrer måned...";
            const promises = [];
            for (let i = currentIdx; i < data.timeline.length; i++) {
                if (data.timeline[i].month !== currentMonth) break;
                if (!data.timeline[i].isPast || data.timeline[i].id === currentWeekId) promises.push(save(ansattId, prosjektId, data.timeline[i].id, value, true));
            }
            await Promise.all(promises);
            document.getElementById('saveStatus').innerText = "Lagret";
            setTimeout(() => document.getElementById('saveStatus').innerText = "", 800);
            renderUI();
        }

        function renderUI() {
            const view = document.getElementById('viewFilter').value;
            const avdelingSelect = document.getElementById('avdelingFilter');
            const klyngeSelect = document.getElementById('klyngeFilter');

            document.getElementById('chartSection').style.display = (view === 'ansatte' || view === 'ledig') ? 'block' : 'none';
            document.getElementById('statsSection').style.display = view === 'prosjekter' ? 'grid' : 'none';
            avdelingSelect.style.display = view === 'prosjekter' ? 'none' : 'inline-block';
            klyngeSelect.style.display = (view === 'prosjekter' || avdelingSelect.value === 'Alle' || klyngeSelect.options.length <= 1) ? 'none' : 'inline-block';

            const head = document.getElementById('tableHead');
            let yrs = '<th class="name-col header-year"></th>', mos = '<th class="name-col header-month">Navn</th>', wks = '<th class="name-col header-week"></th>';
            let curY = data.timeline[0].year, yC = 0, curM = data.timeline[0].month, mC = 0;
            data.timeline.forEach((t, i) => {
                const isCur = t.id === currentWeekId;
                wks += `<th class="header-week ${isCur?'current-week':''}" data-week-id="${esc(t.id)}">U${t.week}</th>`;
                if (t.year === curY) yC++; else { yrs += `<th colspan="${yC}" class="header-year">${curY}</th>`; curY = t.year; yC = 1; }
                if (t.month === curM) mC++; else { mos += `<th colspan="${mC}" class="header-month">${esc(curM)}</th>`; curM = t.month; mC = 1; }
                if (i === data.timeline.length - 1) { yrs += `<th colspan="${yC}" class="header-year">${curY}</th>`; mos += `<th colspan="${mC}" class="header-month">${esc(t.month)}</th>`; }
            });
            head.innerHTML = `<tr>${yrs}</tr><tr>${mos}</tr><tr>${wks}</tr>`;

            const body = document.getElementById('tableBody'); body.innerHTML = '';
            
            if (view === 'ansatte' || view === 'ledig') {
                getFilteredEmployees().forEach(emp => {
                    const tr = document.createElement('tr'); tr.className='row-summary';
                    tr.onclick = (e) => { if(!e.target.closest('button')) { expanded.has(emp.id) ? expanded.delete(emp.id) : expanded.add(emp.id); renderUI(); } };
                    
                    const orgTekst = [emp.avdeling, emp.gruppe].filter(Boolean).join(' / ') || 'Ingen avdeling';
                    const canEditOwnRow = currentUserRole === 'admin' || emp.id === currentUserId;
                    const editBtnHtml = currentUserRole === 'admin' ? `<button class="edit-btn" data-emp-id="${esc(emp.id)}" data-emp-navn="${esc(emp.navn)}" data-emp-avd="${esc(emp.avdeling)}" data-emp-kly="${esc(emp.gruppe)}" data-emp-epost="${esc(emp.email)}" data-emp-role="${esc(emp.rolle)}" data-action="edit-emp">✎</button>` : '';

                    let h = `<td class="name-col"><div class="name-content"><div class="name-row-top"><span>${expanded.has(emp.id)?'▼':'▶'}</span> ${esc(emp.navn)} ${editBtnHtml}</div><div class="name-sub">${esc(orgTekst)}</div></div></td>`;
                             
                    data.timeline.forEach(t => {
                        const sum = data.assignments.filter(a => String(a.ansatt_id) === String(emp.id) && a.uke === t.id).reduce((s, a) => s + Number(a.prosent), 0);
                        // Oppdatert ID her
                        if (view === 'ledig') { const l = 100 - sum; h += `<td id="${safeId('sum_emp', emp.id, t.id)}" style="background-color:${getLedigColor(l)}; color:${l<0?'#f87171':(l===0?'transparent':'inherit')}">${l === 0 ? '' : l + '%'}</td>`; }
                        else { h += `<td id="${safeId('sum_emp', emp.id, t.id)}" style="background-color:${getCellColor(sum)}; color:${sum>100?'#f87171':(sum>0?'inherit':'transparent')}">${sum>0?sum+'%':'-'}</td>`; }
                     });
                    tr.innerHTML = h; body.appendChild(tr);

                    if (expanded.has(emp.id)) {
                        const currentIdx = data.timeline.findIndex(t => t.id === currentWeekId);
                        const sjekkUker = data.timeline.slice(Math.max(0, currentIdx - 6)).map(t => t.id);
                        const alleProsjekter = [...new Set(data.assignments.filter(a => String(a.ansatt_id) === String(emp.id)).map(a => a.prosjekt_id))];
                        
                        alleProsjekter.filter(pId => data.assignments.some(a => String(a.ansatt_id) === String(emp.id) && String(a.prosjekt_id) === String(pId) && sjekkUker.includes(a.uke) && a.prosent > 0) || nyligLagtTil.has(`${emp.id}_${pId}`)).forEach(pId => {
                            const pDb = data.projects.find(p => String(p.id) === String(pId));
                            if (!pDb) return;
                            const ptr = document.createElement('tr'); ptr.className='row-project';
                            const rmBtnHtml = currentUserRole === 'admin' ? `<button class="remove-proj-btn" data-ansatt-id="${esc(emp.id)}" data-prosjekt-id="${esc(pId)}" data-action="remove-proj">×</button>` : '';
                            
                            let ph = `<td class="name-col" style="padding-left:30px;"><div class="name-row-top"><span class="${pDb.er_nc?'nc-tag':(pDb.er_ufakturerbart?'uf-tag':'')}">${pDb.prosjektnummer ? esc(pDb.prosjektnummer) + ' - ' : ''}${esc(pDb.navn)}</span>${rmBtnHtml}</div></td>`;
                            data.timeline.forEach(t => {
                                const a = data.assignments.find(x => String(x.ansatt_id) === String(emp.id) && String(x.prosjekt_id) === String(pId) && x.uke === t.id);
                                const v = a ? a.prosent : ''; const isU = a ? a.er_usikker : false; 
                                if ((t.isPast && t.id !== currentWeekId) || !canEditOwnRow) ph += `<td class="cell-locked">${esc(String(v))}${isU?'u':''}</td>`;
                                else ph += `<td class="${isU?'cell-unsure':''}" title="Dobbelklikk for å fylle måneden"><input class="cell-input" value="${esc(String(v))}${isU?'u':''}" data-ansatt-id="${esc(emp.id)}" data-prosjekt-id="${esc(pId)}" data-uke="${esc(t.id)}" data-action="cell-input"></td>`;
                            });
                            ptr.innerHTML = ph; body.appendChild(ptr);
                        });
                        
                        if (canEditOwnRow) {
                            const addRow = document.createElement('tr');
                            addRow.innerHTML = `<td class="name-col" style="background:var(--tr-add);"><button data-ansatt-id="${esc(emp.id)}" data-action="add-proj" style="font-size:10px; margin-left:20px; background:transparent; border:none; color:var(--text); cursor:pointer;">+ Legg til prosjekt</button></td><td colspan="${data.timeline.length}"></td>`;
                            body.appendChild(addRow);
                        }
                    }
                });
            } else {
                data.projects.forEach(p => {
                    const tr = document.createElement('tr'); tr.className='row-summary'; tr.dataset.projId = p.id;
                    tr.onclick = () => { expanded.has(p.id) ? expanded.delete(p.id) : expanded.add(p.id); renderUI(); };
                    
                    const editBtnHtml = currentUserRole === 'admin' ? `<button class="edit-btn" data-proj-id="${esc(p.id)}" data-proj-nr="${esc(p.prosjektnummer)}" data-proj-navn="${esc(p.navn)}" data-proj-nc="${p.er_nc}" data-proj-uf="${p.er_ufakturerbart}" data-proj-ark="${p.arkivert}" data-action="edit-proj">✎</button>` : '';

                    let h = `<td class="name-col"><div class="name-row-top"><span>${expanded.has(p.id)?'▼':'▶'}</span> <span class="${p.er_nc?'nc-tag':(p.er_ufakturerbart?'uf-tag':'')}">${p.prosjektnummer ? esc(p.prosjektnummer)+' ' : ''}${esc(p.navn)} ${p.arkivert?'(Arkivert)':''}</span>${editBtnHtml}</div></td>`;
                    
                    // Oppdatert ID her
                    data.timeline.forEach(t => { const s = data.assignments.filter(a => String(a.prosjekt_id) === String(p.id) && a.uke === t.id).reduce((sum, a) => sum + Number(a.prosent), 0); h += `<td id="${safeId('sum_proj', p.id, t.id)}" style="background-color:${getCellColor(s)}; color:${s>0?'inherit':'transparent'}">${s>0?s+'%':'-'}</td>`; });
                    tr.innerHTML = h; body.appendChild(tr);
                    
                    if (expanded.has(p.id)) {
                        const currentIdx = data.timeline.findIndex(t => t.id === currentWeekId);
                        const sjekkUker = data.timeline.slice(Math.max(0, currentIdx - 6)).map(t => t.id);
                        const alleAnsatte = [...new Set(data.assignments.filter(a => String(a.prosjekt_id) === String(p.id)).map(a => a.ansatt_id))];
                        
                        alleAnsatte.filter(aId => data.assignments.some(a => String(a.ansatt_id) === String(aId) && String(a.prosjekt_id) === String(p.id) && sjekkUker.includes(a.uke) && a.prosent > 0) || nyligLagtTil.has(`${aId}_${p.id}`)).forEach(aId => {
                            const empDb = data.employees.find(e => String(e.id) === String(aId));
                            if(!empDb) return;
                            const ptr = document.createElement('tr'); ptr.className='row-project';
                            let ph = `<td class="name-col" style="padding-left:30px;">${esc(empDb.navn)}</td>`;
                            
                            const canEditRow = currentUserRole === 'admin' || String(aId) === String(currentUserId);

                            data.timeline.forEach(t => {
                                const a = data.assignments.find(x => String(x.ansatt_id) === String(aId) && String(x.prosjekt_id) === String(p.id) && x.uke === t.id);
                                const v = a ? a.prosent : ''; const isU = a ? a.er_usikker : false;
                                if ((t.isPast && t.id !== currentWeekId) || !canEditRow) ph += `<td class="cell-locked">${esc(String(v))}${isU?'u':''}</td>`;
                                else ph += `<td class="${isU?'cell-unsure':''}"><input class="cell-input" value="${esc(String(v))}${isU?'u':''}" data-ansatt-id="${esc(aId)}" data-prosjekt-id="${esc(p.id)}" data-uke="${esc(t.id)}" data-action="cell-input"></td>`;
                            });
                            ptr.innerHTML = ph; body.appendChild(ptr);
                        });
                    }
                });
            }

            renderTotaler(); updateChart(); updateStats();
        }

        function initListeners() {
            const container = document.getElementById('mainTableContainer');

            container.addEventListener('click', async (e) => {
                const btn = e.target.closest('button[data-action]');
                if (!btn) return;
                e.stopPropagation();
                const action = btn.dataset.action;

                if (action === 'edit-emp') openEditEmployeeModal(btn.dataset.empId, btn.dataset.empNavn, btn.dataset.empAvd, btn.dataset.empKly, btn.dataset.empEpost, btn.dataset.empRole);
                else if (action === 'edit-proj') openEditProjectModal(btn.dataset.projId, btn.dataset.projNr, btn.dataset.projNavn, btn.dataset.projNc === 'true', btn.dataset.projUf === 'true', btn.dataset.projArk === 'true');
                else if (action === 'remove-proj') await removeProjectFromEmployee(btn.dataset.ansattId, btn.dataset.prosjektId);
                else if (action === 'add-proj') openAssignModal(btn.dataset.ansattId);
            });

            const saveTimeouts = {};

            const handleCellUpdate = (inp) => {
                if (!inp) return;
                console.log('Cell update triggered');
                const aId = inp.dataset.ansattId;
                const pId = inp.dataset.prosjektId;
                const uke = inp.dataset.uke;
                const id = `${aId}_${pId}_${uke}`;
                const isU = inp.value.toLowerCase().endsWith('u');
                const val = parseFloat(inp.value.replace('u', '')) || 0;

                console.error('handleCellUpdate', { aId, pId, uke, val, isU, value: inp.value });

                const ex = data.assignments.find(a =>
                    String(a.ansatt_id) === String(aId) &&
                    String(a.prosjekt_id) === String(pId) &&
                    String(a.uke) === String(uke)
                );

                if (ex) {
                    ex.prosent = val;
                    ex.er_usikker = isU;
                } else {
                    data.assignments.push({
                        id: `${aId}_${pId}_${uke}`,
                        ansatt_id: aId,
                        prosjekt_id: pId,
                        uke,
                        prosent: val,
                        er_usikker: isU
                    });
                }

                oppdaterLokalSum(aId, pId, uke);
                renderTotaler();
                updateChart();
                updateStats();

                clearTimeout(saveTimeouts[id]);
                saveTimeouts[id] = setTimeout(async () => { await save(aId, pId, uke, inp.value, true); }, 500);
            };

            window.addEventListener('input', (e) => {
                console.log('Input event fired');
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

            window.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                if (e.target.tagName === 'INPUT' && e.target.dataset.action === 'cell-input') {
                    console.log('Enter pressed on input');
                    e.target.blur();
                    handleCellUpdate(e.target);
                }
            }, true);

            container.addEventListener('dblclick', async (e) => {
                if (e.target.tagName === 'INPUT' && e.target.dataset.action === 'cell-input') {
                    await fillMonth(e.target.dataset.ansattId, e.target.dataset.prosjektId, e.target.dataset.uke, e.target.value);
                }
            });
        }

        function renderTotaler() {
            const view = document.getElementById('viewFilter').value;
            const foot = document.getElementById('tableFoot');
            if (view === 'prosjekter') { foot.innerHTML = ''; return; }
            
            const fEmps = getFilteredEmployees();
            let h = `<tr class="row-total"><td class="name-col">${view === 'ledig' ? 'SNITT LEDIG' : 'TOTAL UTNYTTELSE'}</td>`;
            data.timeline.forEach(t => {
                let total = 0; fEmps.forEach(e => { total += data.assignments.filter(a => String(a.ansatt_id) === String(e.id) && a.uke === t.id).reduce((s, a) => s + Number(a.prosent), 0); });
                const avg = Math.round(total / (fEmps.length || 1));
                if (view === 'ledig') { const l = 100 - avg; h += `<td id="${safeId('total', t.id)}" style="background-color:${getLedigColor(l)}; color:${l<0?'#f87171':(l===0?'transparent':'inherit')}">${l === 0 ? '' : l + '%'}</td>`; }
                else h += `<td id="${safeId('total', t.id)}" style="background-color:${getCellColor(avg)}; color:${avg>0?'inherit':'transparent'}">${avg}%</td>`;
        });
            foot.innerHTML = h + '</tr>';
        }

        function updateChart() {
            const view = document.getElementById('viewFilter').value;
            const fEmps = getFilteredEmployees();
            const n = fEmps.length || 1;
            const isLight = document.documentElement.classList.contains('light-mode');
            const tickColor = isLight ? '#6b7280' : '#a1a1aa';
            
            const currentIdx = data.timeline.findIndex(t => t.id === currentWeekId);
            const startIdx = Math.max(0, currentIdx - 1); 
            const chartTimeline = data.timeline.slice(startIdx);
            
            const datasets = [];
            const labels = chartTimeline.map(t => 'U'+t.week);
            const totalUtil = chartTimeline.map(t => { let s = 0; fEmps.forEach(e => { s += data.assignments.filter(a => String(a.ansatt_id) === String(e.id) && a.uke === t.id && !a.er_usikker).reduce((sum, a) => sum + Number(a.prosent), 0); }); return Math.round(s/n); });
            const unsureUtil = chartTimeline.map(t => { let s = 0; fEmps.forEach(e => { s += data.assignments.filter(a => String(a.ansatt_id) === String(e.id) && a.uke === t.id).reduce((sum, a) => sum + Number(a.prosent), 0); }); return Math.round(s/n); });

            if (view === 'ledig') {
                datasets.push({ label: 'Garantert ledig', data: totalUtil.map(v => 100 - v), borderColor: '#3b82f6', fill: false, tension: 0.3, pointRadius: 0 });
                datasets.push({ label: 'Ledig (inkl. usikre)', data: unsureUtil.map(v => 100 - v), borderColor: '#fbbf24', borderDash: [2, 2], fill: false, tension: 0.3, pointRadius: 0 });
            } else {
                const faktUtil = chartTimeline.map(t => { let s = 0; fEmps.forEach(e => { s += data.assignments.filter(a => { const p = data.projects.find(x => String(x.id) === String(a.prosjekt_id)); return String(a.ansatt_id) === String(e.id) && a.uke === t.id && p && !p.er_ufakturerbart && !a.er_usikker; }).reduce((sum, a) => sum + Number(a.prosent), 0); }); return Math.round(s/n); });
                datasets.push({ label: 'Sikker Total', data: totalUtil, borderColor: '#3b82f6', fill: false, tension: 0.3, pointRadius: 0 });
                datasets.push({ label: 'Fakturerbar', data: faktUtil, borderColor: isLight ? '#1f2937' : '#fff', borderDash: [5, 5], fill: false, tension: 0.3, pointRadius: 0 });
                datasets.push({ label: 'Inkl. Usikker', data: unsureUtil, borderColor: '#fbbf24', borderDash: [2, 2], fill: false, tension: 0.3, pointRadius: 0 });
            }

            const annotations = {};
            chartTimeline.forEach((t, i) => {
                const ferierDetteAret = getHolidays(t.year);
                if (ferierDetteAret[t.week]) {
                    annotations[`ferie_${t.id}`] = { type: 'box', xMin: i - 0.5, xMax: i + 0.5, backgroundColor: 'rgba(34, 197, 94, 0.1)', borderWidth: 0, label: { display: true, content: ferierDetteAret[t.week], position: 'center', rotation: -90, color: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)', font: { size: 11, weight: 'bold' } } };
                }
                if (t.id === currentWeekId) {
                    annotations['currentWeek'] = { type: 'line', xMin: i, xMax: i, borderColor: '#3b82f6', borderWidth: 2, borderDash: [5, 5], label: { display: true, content: '', position: 'start', backgroundColor: '#3b82f6', color: '#fff', font: { size: 10, weight: 'bold' }, yAdjust: 5 } };
                }
            });

            const ctx = document.getElementById('utilizationChart').getContext('2d');
            if (chartInstance) chartInstance.destroy();
            chartInstance = new Chart(ctx, { type: 'line', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: view === 'ledig' ? 100 : 120, ticks: { color: tickColor } }, x: { ticks: { color: tickColor } } }, plugins: { annotation: { annotations }, legend: { labels: { color: tickColor } } } } });
        }

        function updateStats() {
            const fakt = data.projects.filter(p => !p.er_ufakturerbart && !p.arkivert);
            const nc = fakt.filter(p => p.er_nc);
            document.getElementById('statNordicCount').innerText = fakt.length - nc.length;
            document.getElementById('statNC').innerText = nc.length;
            document.getElementById('statPercNC').innerText = fakt.length > 0 ? Math.round((nc.length / fakt.length) * 100) + '%' : '0%';
        }

        function openAssignModal(ansattId) { activeAssigneeId = ansattId; document.getElementById('projectSearch').value = ""; document.getElementById('assignModal').style.display = 'flex'; filterProjects(); }
        
        function openNewProjectModal() { 
            document.getElementById('modalTitle').innerText="Nytt Prosjekt"; document.getElementById('editProjId').value=""; document.getElementById('projNo').value=""; document.getElementById('projName').value=""; document.getElementById('projArkivert').checked=false; document.getElementById('deleteBtn').style.display="none"; document.getElementById('archiveSection').style.display="none"; document.getElementById('mergeSection').style.display="none"; document.getElementById('projectModal').style.display="flex"; 
        }
        
        function openEditProjectModal(id, nr, navn, isNC, isUF, isArkivert) { 
            document.getElementById('modalTitle').innerText="Rediger Prosjekt"; document.getElementById('editProjId').value=id; document.getElementById('projNo').value=nr; document.getElementById('projName').value=navn; document.querySelector(`input[name="projType"][value="${isNC?'nc':(isUF?'uf':'nordic')}"]`).checked=true; document.getElementById('projArkivert').checked = isArkivert; document.getElementById('archiveSection').style.display="block"; document.getElementById('deleteBtn').style.display="block"; 

            if (currentUserRole === 'admin') {
                document.getElementById('mergeSection').style.display="block";
                document.getElementById('mergeTargetProject').innerHTML = '<option value="">-- Velg prosjekt å slå sammen med --</option>' + data.projects.filter(p => p.id !== id).map(p => `<option value="${p.id}">${esc(p.navn)}</option>`).join('');
            } else { document.getElementById('mergeSection').style.display="none"; }
            document.getElementById('projectModal').style.display="flex"; 
        }
        
        function openEditEmployeeModal(id, navn, avdeling, klynge, epost, rolle) { 
            document.getElementById('editEmpId').value = id; document.getElementById('editEmpName').value = navn; document.getElementById('editEmpAvdeling').value = avdeling && avdeling !== 'undefined' ? avdeling : ''; document.getElementById('editEmpKlynge').value = klynge && klynge !== 'undefined' ? klynge : ''; document.getElementById('editEmpEmail').value = epost && epost !== 'undefined' ? epost : ''; document.getElementById('editEmpRole').value = rolle && rolle !== 'undefined' ? rolle : 'ansatt'; document.getElementById('employeeModal').style.display='flex'; 
        }

        function openNewEmployeeModal() {
            document.getElementById('editEmpId').value = ""; document.getElementById('editEmpName').value = ""; document.getElementById('editEmpAvdeling').value = ""; document.getElementById('editEmpKlynge').value = ""; document.getElementById('editEmpEmail').value = ""; document.getElementById('editEmpRole').value = "ansatt"; document.getElementById('employeeModal').style.display='flex';
        }

        function oppdaterLokalSum(ansattId, prosjektId, uke) {
            console.log('Updating sum');
    const view = document.getElementById('viewFilter').value;

    let targetCell;
    if (view === 'ansatte' || view === 'ledig') {
        targetCell = findIdCell('sum_emp', ansattId, uke);
        console.error('oppdaterLokalSum employee', { targetCellId: targetCell?.id, view, ansattId, uke });
        if (!targetCell) return;

        const nySum = data.assignments
            .filter(a => String(a.ansatt_id) === String(ansattId) && String(a.uke) === String(uke))
            .reduce((s, a) => s + (Number(a.prosent) || 0), 0);

        console.log('nySum:', nySum);
        if (view === 'ledig') {
            const ledig = 100 - nySum;
            targetCell.style.backgroundColor = getLedigColor(ledig);
            targetCell.textContent = ledig === 0 ? '' : ledig + '%';
            targetCell.style.color = ledig < 0 ? '#f87171' : 'inherit';
        } else {
            targetCell.style.backgroundColor = getCellColor(nySum);
            targetCell.textContent = nySum > 0 ? nySum + '%' : '-';
            targetCell.style.color = nySum > 100 ? '#f87171' : 'inherit';
        }
        console.log('Updated targetCell.textContent to:', targetCell.textContent);
    } else {
        targetCell = findIdCell('sum_proj', prosjektId, uke);
        if (!targetCell) {
            const row = document.querySelector(`tr.row-summary[data-proj-id="${prosjektId}"]`);
            if (row) {
                const weekIndex = data.timeline.findIndex(t => String(t.id) === String(uke));
                if (weekIndex >= 0 && row.cells[weekIndex + 1]) {
                    targetCell = row.cells[weekIndex + 1];
                }
            }
        }
        console.error('oppdaterLokalSum project', { targetCellId: targetCell?.id, view, prosjektId, uke });
        if (!targetCell) return;

        const nySum = data.assignments
            .filter(a => String(a.prosjekt_id) === String(prosjektId) && String(a.uke) === String(uke))
            .reduce((s, a) => s + (Number(a.prosent) || 0), 0);

        console.log('nySum project:', nySum);
        targetCell.style.backgroundColor = getCellColor(nySum);
        targetCell.textContent = nySum > 0 ? nySum + '%' : '-';
        targetCell.style.color = nySum > 0 ? 'inherit' : 'transparent';
        console.log('Updated targetCell.textContent to:', targetCell.textContent);
    }

    // Oppdater totalraden i footer
    const fEmps = getFilteredEmployees();
    const totalCell = findIdCell('total', uke);
    if (totalCell && fEmps.length > 0) {
        const total = fEmps.reduce((sum, e) => {
            return sum + data.assignments
                .filter(a => String(a.ansatt_id) === String(e.id) && String(a.uke) === String(uke))
                .reduce((s, a) => s + (Number(a.prosent) || 0), 0);
        }, 0);
        const avg = Math.round(total / fEmps.length);
        if (view === 'ledig') {
            const l = 100 - avg;
            totalCell.style.backgroundColor = getLedigColor(l);
            totalCell.textContent = l === 0 ? '' : l + '%';
            totalCell.style.color = l < 0 ? '#f87171' : 'inherit';
        } else {
            totalCell.style.backgroundColor = getCellColor(avg);
            totalCell.textContent = avg + '%';
            totalCell.style.color = avg > 0 ? 'inherit' : 'transparent';
        }
    }
}

        async function saveProject() { 
            const id = document.getElementById('editProjId').value; const nr = document.getElementById('projNo').value.trim(); const navn = document.getElementById('projName').value.trim(); const type = document.querySelector('input[name="projType"]:checked').value; const arkivert = document.getElementById('projArkivert').checked;
            if(!navn) return; 

            if (id) { await db.from('prosjekter').update({prosjektnummer:nr, navn:navn, er_nc:type==='nc', er_ufakturerbart:type==='uf', arkivert:arkivert}).eq('id', id); } 
            else {
                const checkNavn = navn.toLowerCase().replace(/\s+/g, '');
                const lignende = data.projects.find(p => (nr && p.prosjektnummer === nr) || p.navn.toLowerCase().replace(/\s+/g, '') === checkNavn);
                if (lignende && !confirm(`Advarsel: Lignende navn ("${lignende.navn}") finnes. Fortsett?`)) return; 
                await db.from('prosjekter').insert([{prosjektnummer:nr, navn:navn, er_nc:type==='nc', er_ufakturerbart:type==='uf', arkivert:arkivert}]); 
            }
            await fetchData(); renderUI(); closeModals(); 
        }

        async function executeMerge() {
            const oldId = document.getElementById('editProjId').value; const newId = document.getElementById('mergeTargetProject').value;
            if (!newId) return alert("Velg et prosjekt.");
            if (!confirm("Sikker? Sletter dette og flytter timer til valgt prosjekt. Kan ikke angres.")) return;
            
            document.getElementById('saveStatus').innerText = "Slår sammen...";
            const toUpsert = [];
            data.assignments.filter(a => String(a.prosjekt_id) === String(oldId)).forEach(oldA => {
                const existing = data.assignments.filter(a => String(a.prosjekt_id) === String(newId)).find(nA => String(nA.ansatt_id) === String(oldA.ansatt_id) && nA.uke === oldA.uke);
                if (existing) toUpsert.push({ ...existing, prosent: existing.prosent + oldA.prosent, er_usikker: existing.er_usikker || oldA.er_usikker });
                else toUpsert.push({ ...oldA, prosjekt_id: newId, id: `${oldA.ansatt_id}_${newId}_${oldA.uke}` });
            });

            if (toUpsert.length > 0) {
                for (let i = 0; i < toUpsert.length; i += 1000) await db.from('bemanning').upsert(toUpsert.slice(i, i + 1000));
                await db.from('bemanning').delete().eq('prosjekt_id', oldId);
            }
            await db.from('prosjekter').delete().eq('id', oldId);
            
            document.getElementById('saveStatus').innerText = "Ferdig!"; setTimeout(() => document.getElementById('saveStatus').innerText = "", 1500);
            await fetchData(); renderUI(); closeModals(); 
        }

        async function deleteProject() { if(confirm("Slette prosjektet?")) { await db.from('prosjekter').delete().eq('id', document.getElementById('editProjId').value); await fetchData(); renderUI(); closeModals(); } }
        
        async function saveEmployee() { 
            const id = document.getElementById('editEmpId').value; const navn = document.getElementById('editEmpName').value.trim(); const avdeling = document.getElementById('editEmpAvdeling').value.trim(); const klynge = document.getElementById('editEmpKlynge').value.trim(); const epost = document.getElementById('editEmpEmail').value.trim().toLowerCase(); const rolle = document.getElementById('editEmpRole').value;
            if (!navn) return;

            if (id) await db.from('ansatte').update({navn: navn, avdeling: avdeling, gruppe: klynge, email: epost, rolle: rolle}).eq('id', id); 
            else {
                if (data.employees.find(e => e.navn.toLowerCase() === navn.toLowerCase())) return alert("Finnes allerede!");
                await db.from('ansatte').insert([{navn: navn, avdeling: avdeling, gruppe: klynge, email: epost, rolle: rolle}]);
            }
            await fetchData(); updateFilterDropdowns(); renderUI(); closeModals(); 
        }

        async function removeProjectFromEmployee(ansattId, prosjektId) { if(confirm("Fjerne fra ansatt?")) { await db.from('bemanning').delete().eq('ansatt_id', ansattId).eq('prosjekt_id', prosjektId); await fetchData(); renderUI(); } }
        function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display='none'); }
        
        function filterProjects() { 
            const s = document.getElementById('projectSearch').value.toLowerCase();
            const l = document.getElementById('projectList'); l.innerHTML=''; 
            data.projects.filter(p => p.navn.toLowerCase().includes(s) && !p.arkivert).forEach(p => { 
                const d=document.createElement('div'); d.style.padding="10px"; d.style.cursor="pointer"; d.textContent = p.navn;  
                d.onclick=async()=>{ nyligLagtTil.add(`${activeAssigneeId}_${p.id}`); await save(activeAssigneeId, p.id, currentWeekId, '0'); closeModals(); renderUI(); setTimeout(scrollToCurrentWeek, 100); }; 
                l.appendChild(d); 
            }); 
        }

        checkUser();