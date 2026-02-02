const SignalProcessor = {
    fs: 500,

    parseCSV: function(csvText) {
        const lines = csvText.split('\n');
        const time = [];
        const raw = [];
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].trim();
            if (!row) continue;
            const cols = row.split(',');
            if (cols.length >= 2) {
                time.push(parseFloat(cols[0]));
                raw.push(parseFloat(cols[1]));
            }
        }
        return { time, raw };
    },

    applyButterworth: function(rawData) {
        let hpData = this.runHighPass(rawData);
        let lpForward = this.runLowPass(hpData);
        let reversed = [...lpForward].reverse();
        let lpBackward = this.runLowPass(reversed);
        return lpBackward.reverse();
    },

    runHighPass: function(data) {
        const output = new Array(data.length); output[0] = 0;
        for (let i = 1; i < data.length; i++) output[i] = 0.995 * (output[i-1] + data[i] - data[i-1]);
        return output;
    },
    
    runLowPass: function(data) {
        const output = new Array(data.length); output[0] = data[0];
        for (let i = 1; i < data.length; i++) output[i] = output[i-1] + 0.25 * (data[i] - output[i-1]);
        return output;
    },

    detectComponents: function(filteredData, timeData) {
        const annotations = [];
        const boundaries = []; 
        const peakTimes = []; 
        const threshold = 0.3;
        const minDist = 250; 

        for (let i = 150; i < filteredData.length - 300; i++) {
            if (filteredData[i] > threshold && filteredData[i] > filteredData[i-1] && filteredData[i] > filteredData[i+1]) {
                let isMax = true;
                for(let j=1; j<minDist; j++) if(filteredData[i-j] >= filteredData[i]) isMax = false; 
                
                if (isMax) {
                    const rIdx = i;
                    peakTimes.push(timeData[rIdx]); 

                    // --- NEW: DYNAMIC QRS DETECTION ---
                    const qrsBaseline = filteredData[rIdx] * 0.1; // 10% threshold
                    
                    // --- IMPROVED DYNAMIC QRS DETECTION ---
                    // Walk backward to find the Q-point (local minimum)
                    let qrsStartIdx = rIdx;
                    while (qrsStartIdx > rIdx - 60 && qrsStartIdx > 1) {
                        // Continue moving backward as long as the signal is decreasing or flat
                        if (filteredData[qrsStartIdx - 1] <= filteredData[qrsStartIdx]) {
                            qrsStartIdx--;
                        } else {
                            // Found a local minimum (Q-point)
                            break;
                        }
                    }

                    // Walk forward to find the S-point (local minimum)
                    let qrsEndIdx = rIdx;
                    while (qrsEndIdx < rIdx + 60 && qrsEndIdx < filteredData.length - 1) {
                        // Continue moving forward as long as the signal is decreasing or flat
                        if (filteredData[qrsEndIdx + 1] <= filteredData[qrsEndIdx]) {
                            qrsEndIdx++;
                        } else {
                            // Found a local minimum (S-point)
                            break;
                        }
                    }
                    // --------------------------------------

                    const pStartIdx = Math.max(0, rIdx - 110);
                    const pEndIdx = Math.max(0, rIdx - 50);
                    
                    // --- ROBUST T-WAVE DETECTION ---
                    const tStartIdx = rIdx + 60;
                    const maxTSearch = rIdx + 250; 
                    const startAmplitude = filteredData[tStartIdx];
                    
                    // 1. Find the peak of the T-wave
                    let tPeakIdx = tStartIdx;
                    for (let k = tStartIdx; k < maxTSearch; k++) {
                        if (filteredData[k] > filteredData[tPeakIdx]) tPeakIdx = k;
                    }

                    // 2. Walk forward from peak with sustained trend detection
                    let tEndIdx = tPeakIdx;
                    // Define tolerance: within 15% of the starting amplitude gap
                    const amplitudeTolerance = startAmplitude + (filteredData[tPeakIdx] - startAmplitude) * 0.15;

                    for (let m = tPeakIdx; m < maxTSearch - 5; m++) {
                        tEndIdx = m;
                        
                        // Condition A: Signal returns near the starting amplitude
                        const nearStartingAmplitude = filteredData[m] <= amplitudeTolerance;
                        
                        // Condition B: Sustained upward trend (detecting the NEXT P-wave)
                        // We check 5 consecutive points to ensure it's not a local bump/noise
                        let sustainedUpward = true;
                        for (let n = 0; n < 5; n++) {
                            if (filteredData[m + n] >= filteredData[m + n + 1]) {
                                sustainedUpward = false;
                                break;
                            }
                        }

                        // Only break if we are back to baseline OR if a real upward trend starts
                        if (nearStartingAmplitude || sustainedUpward) break;
                    }
                    // --------------------------------

                    boundaries.push(
                        { type: 'p', start: pStartIdx, end: pEndIdx },
                        { type: 'qrs', start: qrsStartIdx, end: qrsEndIdx },
                        { type: 't', start: tStartIdx, end: tEndIdx }
                    );

                    annotations.push({ type: 'box', xMin: timeData[pEndIdx], xMax: timeData[qrsStartIdx], backgroundColor: 'rgba(241, 196, 15, 0.4)', borderWidth: 0, label: { display: false } });
                    annotations.push({ type: 'box', xMin: timeData[qrsStartIdx], xMax: timeData[qrsEndIdx], backgroundColor: 'rgba(52, 152, 219, 0.2)', borderWidth: 0, label: { display: false } });
                    annotations.push({ type: 'box', xMin: timeData[qrsEndIdx], xMax: timeData[tStartIdx], backgroundColor: 'rgba(155, 89, 182, 0.3)', borderWidth: 0, label: { display: false } });

                    i += minDist; 
                }
            }
        }
        return { annotations, boundaries, peakTimes };
    }
};