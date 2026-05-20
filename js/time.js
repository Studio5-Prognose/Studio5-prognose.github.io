// =============================================================
// time.js
// ISO-ukeberegning, norske helligdager og tidslinjebygging.
// =============================================================

// Månedsnavn på norsk, brukt i tidslinja og Excel-eksport
const monthNames = [
    "jan", "feb", "mar", "apr", "mai", "jun",
    "jul", "aug", "sep", "okt", "nov", "des"
];


// =============================================================
// HELLIGDAGER
// =============================================================

/**
 * Returnerer et objekt der nøkkelen er ukenummer og verdien er ferienavn.
 * Brukes av grafen for å markere ferieperioder visuelt.
 *
 * Påskeuken beregnes dynamisk med Butcher's algorithm (fungerer for alle år).
 * Resten er faste ukenummer som gjelder for Norge generelt.
 */
function getHolidays(year) {
    // ── Beregn påskeuke med Butcher's algorithm ──────────────
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
    const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);

    const pMonth = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const pDay   = ((h + l - 7 * m + 114) % 31) + 1;

    // Langfredag er 3 dager før 1. påskedag
    const easterDate = new Date(year, pMonth, pDay - 3, 12, 0, 0);
    const easterWeek = getISOWeekInfo(easterDate).week;

    // ── Faste ferieperioder ───────────────────────────────────
    return {
        8:           "Vinterferie",
        [easterWeek]: "Påskeferie",
        28:          "Sommerferie",
        29:          ".",            // Stille uker (prikk i grafen for å spare plass)
        30:          ".",
        31:          "Sommerferie",
        40:          "Høstferie",
        52:          "Juleferie"
    };
}


// =============================================================
// ISO-UKEBEREGNING
// =============================================================

/**
 * Beregner ISO 8601-ukenummer, år og måned for en gitt dato.
 * ISO-uke starter på mandag og uke 1 er uken med årets første torsdag.
 *
 * Returnerer: { week, year, month }
 * (year kan avvike fra dato.getFullYear() rundt nyttår)
 */
function getISOWeekInfo(date) {
    // Klon datoen og sett tid til middag for å unngå DST-problemer
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);

    // Flytt til torsdagen i samme uke (ISO: mandag = 1, søndag = 7)
    const day = d.getDay() || 7;
    d.setDate(d.getDate() + 4 - day);

    const year        = d.getFullYear();
    const month       = d.getMonth();
    const startOfYear = new Date(year, 0, 1, 12, 0, 0);
    const week        = Math.ceil((((d - startOfYear) / 86400000) + 1) / 7);

    return { week, year, month };
}


// =============================================================
// TIDSLINJEBYGGING
// =============================================================

/**
 * Bygger data.timeline – en liste med 64 uker (12 bakover + ~52 fremover).
 * Hvert element: { id, week, month, year, isPast }
 *
 * Eksempel på id: "u17/26" (uke 17, år 2026)
 * isPast = true for uker før inneværende mandag (låste celler).
 */
function buildTimeline() {
    const now = new Date();
    now.setHours(12, 0, 0, 0);

    // Finn mandagen i inneværende uke
    const currentDay    = now.getDay() || 7; // Gjør søndag (0) til 7
    const currentMonday = new Date(
        now.getFullYear(), now.getMonth(),
        now.getDate() - currentDay + 1,
        12, 0, 0
    );

    // Start 12 uker tilbake i tid
    const startMonday = new Date(
        currentMonday.getFullYear(), currentMonday.getMonth(),
        currentMonday.getDate() - (12 * 7),
        12, 0, 0
    );

    const currentInfo = getISOWeekInfo(now);
    currentWeekId = `u${currentInfo.week}/${currentInfo.year.toString().slice(-2)}`;

    data.timeline = [];

    for (let i = 0; i < 64; i++) {
        const d = new Date(
            startMonday.getFullYear(), startMonday.getMonth(),
            startMonday.getDate() + (i * 7),
            12, 0, 0
        );
        const info = getISOWeekInfo(d);
        const id   = `u${info.week}/${info.year.toString().slice(-2)}`;

        data.timeline.push({
            id,
            week:   info.week,
            month:  monthNames[info.month],
            year:   info.year,
            isPast: d < currentMonday && id !== currentWeekId
        });
    }
}


// =============================================================
// SCROLLING
// =============================================================

/**
 * Scroller tabellen horisontalt slik at inneværende uke er synlig.
 * Trekker fra 280px for å kompensere for den klistrede navnekolonnen.
 *
 * @param {boolean} instant - true = umiddelbar, false = smooth scroll
 */
function scrollToCurrentWeek(instant) {
    const container    = document.getElementById('mainTableContainer');
    const currentWeekEl = document.querySelector(`th[data-week-id="${currentWeekId}"]`);

    if (!container || !currentWeekEl) return;

    const scrollPos = Math.max(0, currentWeekEl.offsetLeft - 280);

    if (instant) {
        container.scrollLeft = scrollPos;
    } else {
        container.scrollTo({ left: scrollPos, behavior: 'smooth' });
    }

    // Synkroniser den øverste scrollbaren etter at scrollingen er ferdig
    setTimeout(syncTopFromMain, 50);
}
