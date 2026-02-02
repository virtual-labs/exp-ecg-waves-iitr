let rawChartInstance = null;
let filteredChartInstance = null;
let timeData = [];
let rawSignal = [];
let filteredSignal = [];
let detectedPeakTimes = []; 

const ManualState = {
    active: false,
    step: 0, 
    points: {},
    annotations: []
};

const descriptions = {
    'p': { title: 'P-Wave', color: '#e74c3c', text: 'Represents atrial depolarization. It helps identify atrial enlargement or arrhythmias like atrial fibrillation.' },
    'qrs': { title: 'QRS Complex', color: '#3498db', text: 'Indicates ventricular depolarization. Its duration helps diagnose bundle branch blocks or ventricular hypertrophy.' },
    't': { title: 'T-Wave', color: '#2ecc71', text: 'Represents ventricular repolarization. Abnormalities can indicate ischemia, electrolyte imbalances, or myocardial infarction.' },
    'pq': { title: 'PQ Segment', color: '#f1c40f', text: 'The isoelectric period following the P-wave. It represents the time delay at the AV node, allowing ventricles to fill.' },
    'st': { title: 'ST Segment', color: '#9b59b2', text: 'The interval between ventricular depolarization and repolarization. Elevation or depression is a critical marker for myocardial ischemia or injury.' }
};

const descDefault = document.getElementById('waveDescDefault');
const descDynamic = document.getElementById('waveDescDynamic');
const descTitle = document.getElementById('descTitle');
const descText = document.getElementById('descText');

const signalSelect = document.getElementById('signalSelect');
const btnLoad = document.getElementById('btnLoad');
const btnFilter = document.getElementById('btnFilter');
const btnAnalyze = document.getElementById('btnAnalyze');
const zoomSlider = document.getElementById('zoomSlider');
const zoomValue = document.getElementById('zoomValue');
const scrollSlider = document.getElementById('scrollSlider');
const scrollContainer = document.getElementById('scrollContainer');
const emptyState = document.getElementById('emptyState');
const rawContainer = document.getElementById('rawContainer');
const filteredContainer = document.getElementById('filteredContainer');
const analysisLegend = document.getElementById('analysisLegend');
const manualLegend = document.getElementById('manualLegend');

const btnManualStart = document.getElementById('btnManualStart');
const btnManualReset = document.getElementById('btnManualReset');
const btnCrossCheck = document.getElementById('btnCrossCheck');
const manualControls = document.getElementById('manualControls');
const manualInstruction = document.getElementById('manualInstruction');
const manualStatus = document.getElementById('manualStatus');

// NEW: Selection for Results Panel
const detailsContent = document.getElementById('detailsContent');

function setupSnapScrolling(peaks) {
    detectedPeakTimes = peaks;
    if (peaks.length === 0) return;
    scrollSlider.min = 0;
    scrollSlider.max = peaks.length - 1;
    scrollSlider.step = 1;
    scrollSlider.value = 0;
    zoomSlider.value = 0.8;
    zoomValue.innerText = "0.8";
    updateSnapView();
}

function updateSnapView() {
    if (detectedPeakTimes.length === 0) return;
    const beatIndex = parseInt(scrollSlider.value);
    const rTime = detectedPeakTimes[beatIndex];
    const windowSize = parseFloat(zoomSlider.value);
    const start = rTime - (windowSize / 2);
    const end = rTime + (windowSize / 2);

    if (rawChartInstance) { 
        rawChartInstance.options.scales.x.min = start; 
        rawChartInstance.options.scales.x.max = end; 
        rawChartInstance.update('none'); 
    }
    if (filteredChartInstance) { 
        filteredChartInstance.options.scales.x.min = start; 
        filteredChartInstance.options.scales.x.max = end; 
        filteredChartInstance.update('none'); 
    }
    // NEW: Update results panel on view change
    updateResultsPanel(beatIndex);
}

// NEW: Helper to stop manual procedure
function stopManualLabelling() {
    ManualState.active = false;
    ManualState.step = 0;
    ManualState.points = {};
    ManualState.annotations = [];
    manualControls.classList.add('hidden');
    btnManualStart.classList.remove('hidden');
    if (filteredChartInstance) {
        filteredChartInstance.options.plugins.annotation.annotations = [];
        filteredChartInstance.update();
    }
}
 const els = {
    btnInstructions: document.getElementById('btnInstructions'),
    modalOverlay: document.getElementById('modalOverlay'),
    modalContent: document.getElementById('modalContent')
};
// Modal Logic
els.btnInstructions.addEventListener('click', (e) => {
    e.stopPropagation();
    els.modalOverlay.style.display = 'flex';
});

els.modalOverlay.addEventListener('click', (e) => {
    if (e.target === els.modalOverlay) els.modalOverlay.style.display = 'none';
});
// NEW: Function to calculate and update results
function updateResultsPanel(beatIndex) {
    const results = SignalProcessor.detectComponents(filteredSignal, timeData);
    const qrsBoundaries = results.boundaries.filter(b => b.type === 'qrs');
    
    // NEW: Calculate Peak Amplitude (Voltage)
    const currentQRS = qrsBoundaries[beatIndex];
    let maxAmp = 0;
    // Search within the specific QRS boundary for the highest voltage point
    for (let i = currentQRS.start; i <= currentQRS.end; i++) {
        if (filteredSignal[i] > maxAmp) maxAmp = filteredSignal[i];
    }

    const qrsDuration = ((currentQRS.end - currentQRS.start) / SignalProcessor.fs) * 1000;

    let rrText = "N/A (Last Beat)";
    let hrText = "N/A";

    if (beatIndex < detectedPeakTimes.length - 1) {
        const rrInterval = detectedPeakTimes[beatIndex + 1] - detectedPeakTimes[beatIndex];
        const heartRate = 60 / rrInterval;
        rrText = `${rrInterval.toFixed(3)} s`;
        hrText = `${Math.round(heartRate)} BPM`;
    }

    detailsContent.innerHTML = `
        <div class="control-group">
            <p class="info-text"><strong>Current Beat:</strong> ${beatIndex + 1}</p>
            <p class="info-text"><strong>QRS Peak Amplitude:</strong> ${maxAmp.toFixed(3)} mV</p>
            <p class="info-text"><strong>QRS Duration:</strong> ${qrsDuration.toFixed(1)} ms</p>
            <p class="info-text"><strong>R-R Interval:</strong> ${rrText}</p>
            <p class="info-text"><strong>Heart Rate:</strong> ${hrText}</p>
        </div>
    `;
}

btnLoad.addEventListener('click', () => {
    const fileUrl = signalSelect.value;
    if (!fileUrl) {
        Swal.fire({
            icon: 'warning',
            title: 'No Signal Selected',
            text: 'Please select a signal to be loaded.',
            confirmButtonColor: '#1a5376'
        });
        return;
    }
    
    stopManualLabelling();

    fetch(fileUrl)
        .then(res => res.text())
        .then(csvText => {
            const data = SignalProcessor.parseCSV(csvText);
            timeData = data.time;
            rawSignal = data.raw;
            filteredSignal = []; 
            detectedPeakTimes = []; 
            
            emptyState.classList.add('hidden');
            
            // --- UPDATED VISIBILITY LOGIC ---
            rawContainer.classList.remove('hidden');
            rawContainer.classList.add('full-height'); // Make Raw Graph take full space
            filteredContainer.classList.add('hidden'); // Ensure Filtered Graph stays hidden
            scrollContainer.classList.remove('hidden');
            analysisLegend.classList.add('hidden');
            // --------------------------------

            zoomSlider.disabled = false;
            scrollSlider.disabled = false;

            const maxTime = timeData[timeData.length - 1];
            scrollSlider.min = 0;
            scrollSlider.max = maxTime;
            scrollSlider.step = 0.1;
            scrollSlider.value = 0;

            const rawPoints = timeData.map((t, i) => ({x: t, y: rawSignal[i]}));
            initRawChart(rawPoints);
            
            // We still init the chart instance so it's ready, but the container is hidden
            initFilteredChart([]); 
            
        });
});

btnFilter.addEventListener('click', () => {
    if (rawSignal.length === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'No Signal Loaded',
            text: 'Please load the raw signal first.',
            confirmButtonColor: '#1a5376'
        });
        return;
    }
    
    filteredSignal = SignalProcessor.applyButterworth(rawSignal);
    
    // --- NEW VISIBILITY LOGIC ---
    filteredContainer.classList.remove('hidden'); // Reveal Filtered Graph
    rawContainer.classList.remove('full-height'); // Shrink Raw Graph to share space
    // ----------------------------

    const filterPoints = timeData.map((t, i) => ({x: t, y: filteredSignal[i]}));
    filteredChartInstance.data.datasets[0].data = filterPoints;
    filteredChartInstance.update();
    
    // Force a resize update on the raw chart so it fits the new 50% height
    if (rawChartInstance) rawChartInstance.resize(); 
});

btnAnalyze.addEventListener('click', () => {
    if (filteredSignal.length === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Please load and filter the signal before starting auto-analysis.',
            confirmButtonColor: '#1a5376'
        });
        return;
    }
    
    stopManualLabelling(); // NEW: Requirement met
    performAutoAnalysis();
});

btnManualStart.addEventListener('click', () => {
    if (filteredSignal.length === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Please load and filter the signal before starting manual labelling.',
            confirmButtonColor: '#1a5376'
        });
        return;
    }
    
    rawContainer.classList.add('hidden');
    filteredContainer.classList.add('full-height');
    btnManualStart.classList.add('hidden');
    manualControls.classList.remove('hidden');
    btnCrossCheck.classList.add('hidden');
    
    const results = SignalProcessor.detectComponents(filteredSignal, timeData);
    setupSnapScrolling(results.peakTimes);
    resetManualMode();
});

function showDescription(type, beatIndex = null) {
    const info = descriptions[type];
    if (!info) return;

    let fullHtml = `<strong style="color:${info.color}">${info.title}</strong><br><span style="color:black">${info.text}</span>`;
    
    let relatedType = null;
    if (type === 'p') relatedType = 'pq';
    if (type === 't') relatedType = 'st';

    if (beatIndex !== null && filteredSignal.length > 0) {
        const results = SignalProcessor.detectComponents(filteredSignal, timeData);
        const p = results.boundaries.filter(x => x.type === 'p')[beatIndex];
        const qrs = results.boundaries.filter(x => x.type === 'qrs')[beatIndex];
        const t = results.boundaries.filter(x => x.type === 't')[beatIndex];

        // 1. Primary Wave Duration
        const primaryBoundary = results.boundaries.filter(x => x.type === type)[beatIndex];
        if (primaryBoundary) {
            const waveDur = ((primaryBoundary.end - primaryBoundary.start) / SignalProcessor.fs) * 1000;
            fullHtml += `<br><span style="color:black"><small><strong>Measured ${info.title} Duration:</strong> ${waveDur.toFixed(1)} ms</small></span>`;
        }

        // 2. Related Segment Duration
        if (relatedType && descriptions[relatedType]) {
            const rel = descriptions[relatedType];
            let segDur = 0;

            if (relatedType === 'pq' && p && qrs) {
                segDur = ((qrs.start - p.end) / SignalProcessor.fs) * 1000;
            } else if (relatedType === 'st' && qrs && t) {
                segDur = ((t.start - qrs.end) / SignalProcessor.fs) * 1000;
            }

            fullHtml += `<br><br><strong style="color:${rel.color}">${rel.title}</strong><br><span style="color:black">${rel.text}</span>`;
            if (segDur > 0) {
                fullHtml += `<br><span style="color:black"><small><strong>Measured ${rel.title} Duration:</strong> ${segDur.toFixed(1)} ms</small></span>`;
            }
        }
    }

    descDefault.classList.add('hidden');
    descDynamic.classList.remove('hidden');
    descDynamic.innerHTML = `<div class="info-text">${fullHtml}</div>`;
}

function resetDescription() {
    descDefault.classList.remove('hidden');
    descDynamic.classList.add('hidden');
}

btnManualReset.addEventListener('click', () => resetManualMode());

function resetManualMode() {
    ManualState.active = true;
    ManualState.step = 1;
    ManualState.points = {};
    ManualState.annotations = [];

    if (filteredChartInstance) {
        // 1. Remove the segment coloring logic and reset line to default blue
        filteredChartInstance.data.datasets[0].segment = null; 
        filteredChartInstance.data.datasets[0].borderColor = '#007bff';

        // 2. Clear all background annotations (manual boxes and auto segments)
        filteredChartInstance.options.plugins.annotation.annotations = [];

        // 3. Update using 'none' to preserve the current scroll and zoom position
        filteredChartInstance.update('none'); 
    }
    
    updateManualUI();
}

// Streamlined Manual UI Update
function updateManualUI() {
    const steps = [
        "Idle", 
        "Select P-Wave Starting Point", "Select P-Wave End Point", 
        "Select QRS-Wave Starting Point", "Select QRS-Wave End Point", 
        "Select T-Wave Starting Point", "Select T-Wave End Point", 
        "Labelling Complete!"
    ];

    // Update the instruction text based on the current step
    manualInstruction.innerText = steps[ManualState.step]
    
    // Ensure the container is visible and spaced correctly
    manualControls.style.display = "flex";
    manualControls.style.flexDirection = "column";
    manualControls.style.gap = "15px";

    // TRIGGER: When all 6 points are selected, the step becomes 7
    if (ManualState.step > 6) {
        ManualState.active = false; // Disable further clicks
        btnCrossCheck.classList.remove('hidden'); // Reveal the Cross-Check button
        btnCrossCheck.style.display = "block"; // Force display if CSS is strict
    }
}

// Cleaned Chart Click Handler
function handleChartClick(event, chart) {
    if (!ManualState.active || ManualState.step > 6) return;
    
    const xValue = chart.scales.x.getValueForPixel(event.x);
    if (xValue === undefined || xValue === null) return;

    // Last point marker logic
    const clickMarker = {
        type: 'line',
        xMin: xValue, xMax: xValue,
        borderColor: 'rgba(0, 0, 0, 0.5)',
        borderWidth: 2, borderDash: [5, 5],
        label: { display: true, content: 'Last Point', position: 'start' }
    };

    const s = ManualState.step;
    // Sequential Point Logic
    if (s === 1) ManualState.points.p_start = xValue;
    else if (s === 2) addManualBox('P', ManualState.points.p_start, xValue, 'rgba(231, 76, 60, 0.2)', '#e74c3c');
    else if (s === 3) ManualState.points.qrs_start = xValue;
    else if (s === 4) addManualBox('QRS', ManualState.points.qrs_start, xValue, 'rgba(52, 152, 219, 0.2)', '#3498db');
    else if (s === 5) ManualState.points.t_start = xValue;
    else if (s === 6) addManualBox('T', ManualState.points.t_start, xValue, 'rgba(46, 204, 113, 0.2)', '#2ecc71');

    ManualState.step++;
    
    // Refresh Annotations
    filteredChartInstance.options.plugins.annotation.annotations = [...ManualState.annotations, clickMarker];
    filteredChartInstance.update();
    updateManualUI();
}

// Simplified Box Addition
function addManualBox(label, start, end, bgColor, borderColor) {
    ManualState.annotations.push({ 
        type: 'box', 
        xMin: Math.min(start, end), 
        xMax: Math.max(start, end), 
        backgroundColor: bgColor, 
        borderColor: borderColor, 
        borderWidth: 2, 
        label: { display: true, content: label + " (Manual)", position: 'start' } 
    });
}

btnCrossCheck.addEventListener('click', () => {
    // 1. Run detection to get the auto-calculated boundaries
    const autoResults = SignalProcessor.detectComponents(filteredSignal, timeData);
    
    if (filteredChartInstance) {
        // 2. Enable colored segments on the existing line
        filteredChartInstance.data.datasets[0].segment = {
            borderColor: ctx => {
                const idx = ctx.p0DataIndex; 
                for (const b of autoResults.boundaries) {
                    if (idx >= b.start && idx <= b.end) {
                        if (b.type === 'p') return '#e74c3c'; // P-wave color
                        if (b.type === 'qrs') return '#3498db'; // QRS color
                        if (b.type === 't') return '#2ecc71';   // T-wave color
                    }
                }
                return '#b0b0b0'; // Default gray for segments between waves
            }
        };

        // 3. Keep ONLY your manual box annotations
        // We removed "...autoResults.annotations" to hide PQ and ST background boxes
        filteredChartInstance.options.plugins.annotation.annotations = [
            ...ManualState.annotations
        ];

        // 4. Update titles
        filteredChartInstance.options.plugins.title.text = "Cross-Check: Manual (Boxes) vs Auto (Colored Line)";

        // 5. Update without resetting the current view
        filteredChartInstance.update('none'); 
    }
    
    manualLegend.classList.remove('hidden');
});

function performAutoAnalysis() {
    rawContainer.classList.add('hidden');
    filteredContainer.classList.add('full-height');
    
    // Show analysis legend, hide manual legend
    analysisLegend.classList.remove('hidden');
    manualLegend.classList.add('hidden');
    
    const detectionResults = SignalProcessor.detectComponents(filteredSignal, timeData);
    setupSnapScrolling(detectionResults.peakTimes); 
    const filterPoints = timeData.map((t, i) => ({x: t, y: filteredSignal[i]}));
    initFilteredChart(filterPoints, detectionResults.boundaries);
    filteredChartInstance.options.plugins.title.text = "ECG Signal (Analyzed)";
    filteredChartInstance.options.plugins.annotation = { annotations: detectionResults.annotations };
    filteredChartInstance.update();
}

zoomSlider.addEventListener('input', (e) => {
    zoomValue.innerText = parseFloat(e.target.value).toFixed(1);
    if (detectedPeakTimes.length > 0) updateSnapView(); else updateView(); 
});

scrollSlider.addEventListener('input', () => { 
    if (detectedPeakTimes.length > 0) updateSnapView(); else updateView(); 
});

function updateView() {
    const windowSize = parseFloat(zoomSlider.value);
    const scrollPos = parseFloat(scrollSlider.value);
    const maxTime = timeData[timeData.length - 1] || 10;
    let start = scrollPos;
    let end = start + windowSize;
    if (end > maxTime) { end = maxTime; start = end - windowSize; }
    if (rawChartInstance) { rawChartInstance.options.scales.x.min = start; rawChartInstance.options.scales.x.max = end; rawChartInstance.update('none'); }
    if (filteredChartInstance) { filteredChartInstance.options.scales.x.min = start; filteredChartInstance.options.scales.x.max = end; filteredChartInstance.update('none'); }
}

function initRawChart(dataPoints) {
    const ctx = document.getElementById('rawChart').getContext('2d');
    if (rawChartInstance) rawChartInstance.destroy();
    rawChartInstance = new Chart(ctx, { type: 'line', data: { datasets: [{ label: 'Raw Voltage', data: dataPoints, borderColor: '#dc3545', borderWidth: 1, pointRadius: 0, tension: 0 }] }, options: getChartOptions("Raw Signal") });
}

function initFilteredChart(dataPoints, boundaryData = null) {
    const ctx = document.getElementById('filteredChart').getContext('2d');
    if (filteredChartInstance) filteredChartInstance.destroy();
    const dataset = { label: 'Filtered Voltage', data: dataPoints, borderWidth: 2, pointRadius: 0, tension: 0.1 };
    
    if (boundaryData) {
        dataset.borderColor = '#b0b0b0'; 
        dataset.segment = { borderColor: ctx => {
            const idx = ctx.p0DataIndex; 
            for (const b of boundaryData) if (idx >= b.start && idx <= b.end) {
                if (b.type === 'p') return '#e74c3c';
                if (b.type === 'qrs') return '#3498db';
                if (b.type === 't') return '#2ecc71';
            }
        }};
    } else dataset.borderColor = '#007bff';

    filteredChartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets: [dataset] },
        options: {
            ...getChartOptions("Filtered Signal"),
            // HOVER: Now handles ALL descriptions for both lines and background boxes
            onHover: (event, elements, chart) => {
                if (!boundaryData) {
                    resetDescription();
                    return;
                }

                const beatIdx = parseInt(scrollSlider.value);

                // 1. Check for wave lines (P, QRS, T)
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    for (const b of boundaryData) {
                        if (idx >= b.start && idx <= b.end) { 
                            showDescription(b.type, beatIdx); 
                            return; 
                        }
                    }
                }

                // 2. Check for background segments (PQ, ST) via mouse position
                const xValue = chart.scales.x.getValueForPixel(event.x);
                const results = SignalProcessor.detectComponents(filteredSignal, timeData);
                for (const annot of results.annotations) {
                    if (xValue >= annot.xMin && xValue <= annot.xMax) {
                        if (annot.backgroundColor.includes('241, 196, 15')) { showDescription('pq', beatIdx); return; }
                        if (annot.backgroundColor.includes('155, 89, 182')) { showDescription('st', beatIdx); return; }
                    }
                }
                
                resetDescription();
            },
            // CLICK: Now strictly for manual labelling logic
            onClick: (event, elements, chart) => {
                handleChartClick(event, chart);
            }
        }
    });
}

function getChartOptions(title) {
    return { 
        responsive: true, 
        maintainAspectRatio: false, 
        animation: false, 
        parsing: false, 
        normalized: true, 
        interaction: { 
            mode: 'nearest', 
            intersect: false 
        }, 
        plugins: { 
            title: { 
                display: true, 
                text: title, 
                font: { size: 16 } 
            }, 
            legend: { display: false }, 
            annotation: { annotations: [] } 
        }, 
        scales: { 
            x: { 
                type: 'linear', 
                title: { display: true, text: 'Time (s)' }, 
                min: 0, 
                max: 10 // Correctly set to 10s default
            }, 
            y: { 
                title: { display: true, text: 'mV' } 
            } 
        } 
    };
}

// NEW: Toggle Logic for the Manual Labelling GIF Dropdown
const btnToggleGif = document.getElementById('btnToggleGif');
const gifContainer = document.getElementById('gifContainer');

// Toggle Logic for the GIF inside the Instructions Modal
// Add to bottom of page.js
const btnToggleGifModal = document.getElementById('btnToggleGifModal');
const gifModalContainer = document.getElementById('gifModalContainer');

if (btnToggleGifModal && gifModalContainer) {
    btnToggleGifModal.addEventListener('click', (e) => {
        e.stopPropagation(); 
        const isHidden = gifModalContainer.classList.contains('hidden');
        if (isHidden) {
            gifModalContainer.classList.remove('hidden');
            btnToggleGifModal.innerHTML = '▲ Close Guide';
        } else {
            gifModalContainer.classList.add('hidden');
            btnToggleGifModal.innerHTML = '▼ Visual Guide';
        }
    });
}