// =============================================================
// main.js
// Innlogging, oppstart og bakgrunnssynkronisering.
// Dette er entry-point – kalles etter at alle andre filer er lastet.
// =============================================================


// =============================================================
// TEMA (lyst/mørkt)
// =============================================================

// Hent lagret tema fra forrige sesjon og appliser umiddelbart
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.documentElement.classList.add('light-mode');
} else {
    document.documentElement.classList.remove('light-mode');
}

// Feillogging til saveStatus-feltet (nyttig for debugging i produksjon)
const saveStatusEl = document.getElementById('saveStatus');
if (saveStatusEl) saveStatusEl.textContent = 'JS loaded';

window.addEventListener('error', (evt) => {
    if (saveStatusEl) saveStatusEl.textContent = 'JS error: ' + evt.message;
    console.error('Unhandled JS error', evt.message, evt.error);
});
window.addEventListener('unhandledrejection', (evt) => {
    if (saveStatusEl) saveStatusEl.textContent = 'JS promise error';
    console.error('Unhandled promise rejection', evt.reason);
});

/** Veksler mellom lyst og mørkt tema og lagrer valget i localStorage. */
function toggleTheme() {
    const html    = document.documentElement;
    const isLight = html.classList.toggle('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');

    // Oppdater grafen med riktige farger for det nye temaet
    if (chartInstance) updateChart();
}


// =============================================================
// AUTENTISERING
// =============================================================

/**
 * Sjekker om brukeren allerede er innlogget (aktiv sesjon i Supabase).
 * Viser enten innloggingsskjermen eller starter appen.
 */
async function checkUser() {
    const { data: { session } } = await db.auth.getSession();

    if (session) {
        currentUserEmail = session.user.email;

        // Cache access token for bruk ved sidenedlasting (flushPendingSaves)
        window._cachedAccessToken = session.access_token;

        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';
        init();
    } else {
        document.getElementById('login-screen').style.display = 'flex';
    }
}

/** Håndterer innlogging med e-post og passord. */
async function handleLogin() {
    const email    = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;

    const { error } = await db.auth.signInWithPassword({ email, password });

    if (error) {
        document.getElementById('login-error').innerText = "Feil e-post eller passord.";
    } else {
        location.reload();
    }
}

/** Logger ut brukeren og laster siden på nytt. */
async function handleLogout() {
    await db.auth.signOut();
    location.reload();
}

/** Åpner dialog for å bytte passord. */
async function changePassword() {
    const ny = prompt("Nytt passord (minst 6 tegn):");
    if (!ny || ny.length < 6) return;

    const { error } = await db.auth.updateUser({ password: ny });
    alert(error ? error.message : "Passord oppdatert!");
}


// =============================================================
// OPPSTART
// =============================================================

/**
 * Initialiserer appen etter vellykket innlogging:
 *  1. Bygger tidslinja
 *  2. Henter data fra Supabase
 *  3. Setter opp filtre og tilgangsnivå
 *  4. Initialiserer event-lyttere
 *  5. Tegner UI og scroller til inneværende uke
 */
async function init() {
    buildTimeline();
    await fetchData();

    // ── Bygg avdelingsliste ───────────────────────────────────
    const avdFilter   = document.getElementById('avdelingFilter');
    const avdelinger  = [...new Set(data.employees.map(e => e.avdeling).filter(Boolean))].sort();
    avdFilter.innerHTML =
        '<option value="Alle">Alle Avdelinger</option>' +
        avdelinger.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');

    // ── Finn innlogget bruker i ansattelisten ─────────────────
    const meg = data.employees.find(e =>
        e.email && e.email.toLowerCase() === currentUserEmail.toLowerCase()
    );
    if (meg) {
        currentUserId   = meg.id;
        currentUserRole = meg.rolle || 'ansatt';

        // Forhåndsvelg brukerens avdeling i filteret
        if (meg.avdeling) avdFilter.value = meg.avdeling;
    }

    // ── Vis/skjul admin-verktøy basert på rolle ───────────────
    const isAdminOrSuper = currentUserRole === 'admin' || currentUserRole === 'superbruker';
    document.getElementById('admin-tools').style.display =
        isAdminOrSuper ? 'flex' : 'none';

    // Backup-gjenoppretting og import av ansatte kun for superbruker
    document.getElementById('backupRestoreBtn').style.display =
        currentUserRole === 'superbruker' ? 'block' : 'none';
    document.getElementById('importAnsatteBtn').style.display =
        currentUserRole === 'superbruker' ? 'block' : 'none';

    // Oppdater klynge-dropdown basert på valgt avdeling
    updateFilterDropdowns(false);

    // Forhåndsvelg brukerens klynge hvis tilgjengelig
    if (meg && meg.gruppe) document.getElementById('klyngeFilter').value = meg.gruppe;

    // ── Start lyttere og tegn UI ──────────────────────────────
    initListeners();
    renderUI();
    // Gjenopprett forrige valg for grafvisning
if (localStorage.getItem('chartSkjult') === 'true') {
    document.getElementById('chartSection').style.display = 'none';
    document.getElementById('chartToggleBtn').textContent = '▼ Vis graf';
}
    // Vent på at DOM-en er ferdig tegnet før vi scroller
    setTimeout(() => {
        setupDualScrollbar();
        scrollToCurrentWeek(true); // true = umiddelbar (ikke smooth)
    }, 300);
}


// =============================================================
// FLUSH PENDING SAVES VED SIDENEDLASTING
// =============================================================

/**
 * Lagrer usavede celleendringer når brukeren navigerer bort fra siden.
 *
 * Nettleseren tillater ikke async/await i beforeunload, så vi bruker
 * fetch() med keepalive: true – dette er en spesiell flag som ber nettleseren
 * fullføre nettverksforespørselen selv etter at siden er lukket.
 *
 * Access token caches i window._cachedAccessToken ved innlogging
 * siden db.auth.getSession() ikke rekker å fullføre under unload.
 */
function flushPendingSaves() {
    const pending = Object.values(pendingSaves);
    if (!pending.length) return;

    // Avbryt alle ventende debounce-timere
    Object.keys(saveTimeouts).forEach(k => clearTimeout(saveTimeouts[k]));

    const token = window._cachedAccessToken || supabaseKey;

    pending.forEach(p => {
        const isUnsure = String(p.value).toLowerCase().endsWith('u');
        const val      = parseFloat(String(p.value).replace('u', '')) || 0;
        const id       = `${p.ansattId}_${p.prosjektId}_${p.uke}`;

        try {
            fetch(`${supabaseUrl}/rest/v1/bemanning?on_conflict=id`, {
                method:  'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey':       supabaseKey,
                    'Authorization': `Bearer ${token}`,
                    'Prefer':       'resolution=merge-duplicates'
                },
                body: JSON.stringify({
                    id,
                    ansatt_id:   p.ansattId,
                    prosjekt_id: p.prosjektId,
                    uke:         p.uke,
                    prosent:     val,
                    er_usikker:  isUnsure
                }),
                keepalive: true  // Fortsett selv etter at siden er lukket
            });
        } catch (err) {
            console.error('Flush failed for id', id, err);
        }
    });
}

window.addEventListener('beforeunload', flushPendingSaves);
window.addEventListener('pagehide',     flushPendingSaves);

function toggleChart() {
    const section = document.getElementById('chartSection');
    const btn     = document.getElementById('chartToggleBtn');
    const skjult  = section.style.display === 'none';

    section.style.display = skjult ? 'block' : 'none';
    btn.textContent       = skjult ? '▲ Skjul graf' : '▼ Vis graf';

    // Lagre valget så det huskes ved neste innlasting
    localStorage.setItem('chartSkjult', skjult ? 'false' : 'true');
}

// =============================================================
// BAKGRUNNSSYNKRONISERING
// =============================================================

/**
 * Henter oppdatert data fra Supabase hvert 5. minutt.
 * Hopper over synkronisering hvis brukeren er midt i en redigering
 * for å unngå at skriving blir avbrutt eller data overskrives.
 */
setInterval(async () => {
    const isTyping    = document.activeElement?.tagName === 'INPUT';
    const hasSelection = document.querySelectorAll('.selected-cell').length > 0;
    const hasPending  = Object.keys(pendingSaves).length > 0;

    if (isTyping || hasSelection || hasPending) return;

    const status = document.getElementById('saveStatus');
    if (status) status.innerText = "Synkroniserer...";

    await fetchData();
    renderUI();

    if (status) status.innerText = "";
}, 5 * 60 * 1000); // 5 minutter


// =============================================================
// START
// =============================================================
checkUser();
