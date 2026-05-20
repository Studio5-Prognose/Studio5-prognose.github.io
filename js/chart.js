// =============================================================
// chart.js
// Tegning av utnyttelsesgrafen med Chart.js.
// Støtter fire visninger: ansatte, ledig, fravær og prosjekter.
// =============================================================

/**
 * Tegner eller oppdaterer utnyttelsesgrafen.
 * @param {object} idx - Valgfri forhåndsbygd indeks fra buildAssignmentIndex().
 */
function updateChart(idx) {
    const view      = document.getElementById('viewFilter').value;
    const isLight   = document.documentElement.classList.contains('light-mode');
    const tickColor = isLight ? '#6b7280' : '#a1a1aa';

    const currentIdx    = data.timeline.findIndex(t => t.id === currentWeekId);
    const chartTimeline = data.timeline.slice(Math.max(0, currentIdx - 1));

    if (!idx) idx = buildAssignmentIndex();

    const labels   = chartTimeline.map(t => 'U' + t.week);
    const datasets = [];
    let yMax       = undefined;
    let isStacked  = false;

    if (view === 'prosjekter') {
        _buildProjectDatasets(chartTimeline, idx, isLight, datasets);
        isStacked = true;
    } else if (view === 'fravær') {
        _buildFravaerDatasets(chartTimeline, idx, datasets);
        yMax = 100;
    } else {
        _buildEmployeeDatasets(view, chartTimeline, idx, isLight, datasets);
        yMax = view === 'ledig' ? 100 : 120;
    }

    const annotations = _buildAnnotations(chartTimeline, isLight);

    const ctx = document.getElementById('utilizationChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    const scaleOptions = {
        y: { beginAtZero: true, stacked: isStacked, ticks: { color: tickColor } },
        x: { stacked: isStacked, ticks: { color: tickColor } }
    };
    if (yMax !== undefined) scaleOptions.y.max = yMax;

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            scales: scaleOptions,
            plugins: {
                annotation: { annotations },
                legend: {
                    labels: {
                        color:         tickColor,
                        usePointStyle: true,
                        pointStyle:    'line',
                        generateLabels: (chart) => {
                            return chart.data.datasets.map((ds, i) => ({
                                text:         ds.label,
                                fontColor:    tickColor, 
                                strokeStyle:  ds.borderColor,
                                lineDash:     ds.borderDash || [],
                                lineWidth:    2,
                                hidden:       !chart.isDatasetVisible(i),
                                datasetIndex: i,
                                fillStyle:    'transparent'
                            }));
                        }
                    }
                },
                tooltip: { mode: isStacked ? 'index' : 'nearest', intersect: false }
            }
        }
    });
}

/**
 * Bygger datasett for prosjektvisning.
 * Fakturerbare timer stables per avdeling, ufakturerbare øverst.
 */
function _buildProjectDatasets(chartTimeline, idx, isLight, datasets) {
    const fakturerbareProsjekter = data.projects.filter(p => !p.er_ufakturerbart);
    const prosjektAvdelinger     = [...new Set(fakturerbareProsjekter.map(p => p.avdeling).filter(Boolean))].sort();
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

    prosjektAvdelinger.forEach((avd, i) => {
        const projsInAvd = fakturerbareProsjekter.filter(p => p.avdeling === avd).map(p => String(p.id));
        if (projsInAvd.length === 0) return;

        const dataPoints = chartTimeline.map(t => {
            const sum = projsInAvd.reduce((acc, pId) => acc + (idx.projSum.get(`${pId}|${t.id}`) || 0), 0);
            return Number((sum / 100).toFixed(1));
        });
        if (!dataPoints.some(v => v > 0)) return;

        datasets.push({
            label: avd, data: dataPoints,
            borderColor:     colors[i % colors.length],
            backgroundColor: colors[i % colors.length] + '80',
            fill: true, tension: 0.1, borderWidth: 1, pointRadius: 0
        });
    });

    const projsUtenAvd = fakturerbareProsjekter.filter(p => !p.avdeling).map(p => String(p.id));
    if (projsUtenAvd.length > 0) {
        const dataPoints = chartTimeline.map(t => {
            const sum = projsUtenAvd.reduce((acc, pId) => acc + (idx.projSum.get(`${pId}|${t.id}`) || 0), 0);
            return Number((sum / 100).toFixed(1));
        });
        if (dataPoints.some(v => v > 0)) {
            datasets.push({ label: 'Fakturerbar (Uten avd)', 
                data: dataPoints, borderColor: '#a1a1aa', 
                backgroundColor: '#a1a1aa80', 
                fill: true, 
                tension: 0.1, 
                borderWidth: 1, 
                pointRadius: 0 });
        }
    }

    // Ufakturerbare (fravær/internt) øverst i stabelen
    const ufaktProsjekter = data.projects.filter(p => p.er_ufakturerbart).map(p => String(p.id));
    if (ufaktProsjekter.length > 0) {
        const dataPoints = chartTimeline.map(t => {
            const sum = ufaktProsjekter.reduce((acc, pId) => acc + (idx.projSum.get(`${pId}|${t.id}`) || 0), 0);
            return Number((sum / 100).toFixed(1));
        });
        if (dataPoints.some(v => v > 0)) {
            datasets.push({
                label: 'Fravær / Internt', data: dataPoints,
                borderColor:     isLight ? '#9ca3af' : '#6b7280',
                backgroundColor: isLight ? '#e5e7eb'  : '#374151',
                fill: true, tension: 0.1, borderWidth: 1, pointRadius: 0
            });
        }
    }
}

/**
 * Bygger datasett for fraværsvisning.
 * Viser gjennomsnittlig fraværsprosent per uke fra fravær/ferie-prosjektet.
 */
function _buildFravaerDatasets(chartTimeline, idx, datasets) {
    const fEmps = getFilteredEmployees();
    const n     = fEmps.length || 1;

    const fraværProj = data.projects.find(p =>
        p.navn.toLowerCase().includes('fravær') || p.navn.toLowerCase().includes('ferie')
    );
    const fraværId = fraværProj ? String(fraværProj.id) : null;

    const fravaerUtil = chartTimeline.map(t => {
        let s = 0;
        if (fraværId) {
            fEmps.forEach(e => {
                const a = idx.exact.get(`${e.id}|${fraværId}|${t.id}`);
                if (a) s += Number(a.prosent);
            });
        }
        return Math.round(s / n);
    });

    datasets.push({
        label:           'Snitt Fravær (%)',
        data:            fravaerUtil,
        borderColor:     '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        fill:            true,
        tension:         0.1,
        pointRadius:     0
    });
}

/**
 * Bygger datasett for ansatt- og ledigvisning.
 */
function _buildEmployeeDatasets(view, chartTimeline, idx, isLight, datasets) {
    const fEmps = getFilteredEmployees();
    const n     = fEmps.length || 1;

    const totalUtil = chartTimeline.map(t => {
        let s = 0; fEmps.forEach(e => { s += idx.empSumSure.get(`${e.id}|${t.id}`) || 0; }); return Math.round(s / n);
    });
    const unsureUtil = chartTimeline.map(t => {
        let s = 0; fEmps.forEach(e => { s += idx.empSum.get(`${e.id}|${t.id}`) || 0; }); return Math.round(s / n);
    });

    if (view === 'ledig') {
        datasets.push({ label: 'Garantert ledig', data: totalUtil.map(v => 100 - v), borderColor: '#3b82f6', fill: false, tension: 0.1, pointRadius: 0 });
        datasets.push({ label: 'Ledig (inkl. usikre)', data: unsureUtil.map(v => 100 - v), borderColor: '#fbbf24', borderDash: [2, 2], fill: false, tension: 0.1, pointRadius: 0 });
    } else {
        const faktUtil = chartTimeline.map(t => {
            let s = 0; fEmps.forEach(e => { s += idx.empSumFakt.get(`${e.id}|${t.id}`) || 0; }); return Math.round(s / n);
        });
        datasets.push({ label: 'Sikker Total', data: totalUtil, borderColor: '#3b82f6', fill: false, tension: 0.1, pointRadius: 0 });
        datasets.push({ label: 'Fakturerbar', data: faktUtil, borderColor: isLight ? '#1f2937' : '#fff', borderDash: [5, 5], fill: false, tension: 0.1, borderWidth: 1, pointRadius: 0 });
        datasets.push({ label: 'Inkl. Usikker', data: unsureUtil, borderColor: '#fbbf24', borderDash: [2, 2], fill: false, tension: 0.1, borderWidth: 1, pointRadius: 0 });
    }
}

/**
 * Bygger annotasjoner for ferieperioder og inneværende uke.
 */
function _buildAnnotations(chartTimeline, isLight) {
    const annotations = {};
    const labelColor  = isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)';

    chartTimeline.forEach((t, i) => {
        const ferier = getHolidays(t.year);

        if (ferier[t.week]) {
            annotations[`ferie_${t.id}`] = {
                type:            'box',
                xMin:            i - 0.5,
                xMax:            i + 0.5,
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderWidth:     0,
                label: {
                    display:  true,
                    content:  ferier[t.week],
                    position: 'center',
                    rotation: -90,
                    color:    labelColor,
                    font:     { size: 13, weight: 'normal' }
                }
            };
        }

        if (t.id === currentWeekId) {
            annotations['currentWeek'] = {
                type:        'line',
                xMin:        i,
                xMax:        i,
                borderColor: '#3b82f6',
                borderWidth: 2,
                borderDash:  [5, 5]
            };
        }
    });

    return annotations;
}
