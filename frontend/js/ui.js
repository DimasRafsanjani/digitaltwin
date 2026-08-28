import { S, realData, AppState } from './state.js';
import { buildPlant, toggleSoil, resetCamera } from './3d-engine.js';

let hasAlertedHarvest = false;

export function checkHarvestWarning() {
    if (S.age >= 120 && !hasAlertedHarvest) {
        hasAlertedHarvest = true;
        setTimeout(() => {
            if (confirm("Peringatan: Padi Siap Panen! (Usia >= 120 HST).\n\nApakah Anda ingin memanen padi ini dan menyetel ulang (reset) tanggal tanam ke hari ini?")) {
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const dd = String(today.getDate()).padStart(2, '0');
                const formattedDate = `${yyyy}-${mm}-${dd}`;
                
                const dateInput = document.getElementById('input-planting-date');
                if (dateInput) {
                    dateInput.value = formattedDate;
                    const event = new Event('change');
                    dateInput.dispatchEvent(event);
                }
            }
            hasAlertedHarvest = false;
        }, 300);
    }
}

export function updateDeviceStatus(status, timestamp) {
    const badge = document.getElementById('stage-display');
    if (!badge) return;
    
    const espStatus = document.getElementById('val-esp-status');
    let timeStr = "";
    
    if (timestamp) {
        const date = new Date(timestamp);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        timeStr = ` (${hours}:${minutes}:${seconds})`;
    }
    
    if (status === "online" || status === true) {
        AppState.deviceStatus = "Alat: ONLINE" + timeStr;
        badge.style.background = "#3cf08d";
        badge.style.color = "#000";
        if(espStatus) {
            espStatus.innerText = "Online";
            espStatus.style.color = "#4ade80";
        }
    } else if (status === "offline" || status === false) {
        AppState.deviceStatus = "Alat: DEEP SLEEP";
        badge.style.background = "#f59e0b"; // Oranye (bukan merah)
        badge.style.color = "#000";
        if(espStatus) {
            espStatus.innerText = "Deep Sleep";
            espStatus.style.color = "#f59e0b";
        }
    } else {
        AppState.deviceStatus = "Menunggu Data...";
        badge.style.background = "#2a3547";
        badge.style.color = "#94a3b8";
        if(espStatus) {
            espStatus.innerText = "Waiting...";
            espStatus.style.color = "#94a3b8";
        }
    }
    const phase = S.age >= 90 ? "Fase Pematangan" : (S.age >= 60 ? "Fase Reproduktif" : "Fase Vegetatif");
    badge.innerText = phase + " | " + AppState.deviceStatus;
}

export function updateLastTimestamp(timestamp) {
    const el = document.getElementById('val-last-update');
    if (!el) return;
    
    if (timestamp) {
        const date = new Date(timestamp);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        
        el.innerText = `Terakhir Update: ${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    } else {
        el.innerText = "Terakhir Update: Belum ada data";
    }
}

export function updateHealthUI(battery, isSensorHealthy) {
    const batEl = document.getElementById('val-battery');
    const sensEl = document.getElementById('val-sensor-status');
    
    if(batEl) {
        if (battery !== undefined && battery !== null && battery !== "waiting") {
            batEl.innerText = battery + "%";
            batEl.style.color = battery > 20 ? "#4ade80" : "#ef4444";
        } else {
            batEl.innerText = "--%";
            batEl.style.color = "#94a3b8";
        }
    }
    
    if(sensEl) {
        if (isSensorHealthy === "waiting" || isSensorHealthy === "unknown" || isSensorHealthy === undefined) {
            sensEl.innerText = "Waiting...";
            sensEl.style.color = "#94a3b8";
        } else if (isSensorHealthy === true || isSensorHealthy === 1 || isSensorHealthy === "true" || isSensorHealthy === "healthy") {
            sensEl.innerText = "Healthy";
            sensEl.style.color = "#4ade80";
        } else {
            sensEl.innerText = "Error (NaN)";
            sensEl.style.color = "#f59e0b"; // Warning Orange
        }
    }
}

export function updateUI() {
    document.getElementById('val-moisture').innerText = S.moisture + "%";
    document.getElementById('val-tds').innerText = S.tds + " ppm";
    const lightText = S.light >= 1000 ? (S.light / 1000).toFixed(1) + "k lux" : S.light + " lux";
    document.getElementById('val-light').innerText = lightText;
    document.getElementById('val-env').innerText = S.atemp + "°C / " + S.humi + "%";
    document.getElementById('val-wtemp').innerText = S.wtemp + " °C";
    
    document.getElementById('val-moisture').className = "value " + (S.moisture < 45 ? "alert-low" : "");
    document.getElementById('val-tds').className = "value " + (S.tds < 400 ? "alert-low" : (S.tds > 1500 ? "alert-high" : ""));
    document.getElementById('val-env').className = "value " + (S.atemp > 38 || S.atemp < 15 ? "alert-high" : "");

    // Sinkronisasi teks label slider dengan nilai saat ini
    const setDisp = (id, val) => {
        const el = document.getElementById(id + '-val');
        if (el) el.innerText = val;
    };
    setDisp('slider-age', S.age);
    setDisp('slider-moisture', S.moisture);
    setDisp('slider-atemp', S.atemp);
    setDisp('slider-humi', S.humi);
    setDisp('slider-tds', S.tds);
    setDisp('slider-light', S.light);
    setDisp('slider-wtemp', S.wtemp);

    // Periksa status siap panen
    checkHarvestWarning();
}

export function updateAgeFromPlantingDate(dateStr) {
    if (!dateStr) return;
    const plantingDate = new Date(dateStr);
    const diffTime = Date.now() - plantingDate.getTime();
    let calculatedAge = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    // S.age is clamped 1-120
    calculatedAge = Math.max(1, Math.min(calculatedAge, 120));
    
    S.age = calculatedAge;
    const slider = document.getElementById('slider-age');
    if(slider) slider.value = calculatedAge;
    buildPlant();
    updateUI();
}

export function initUI() {
    // --- FUNGSI CLASS DIAGRAM ---
    function SimulasiManual(e, k) {
        S[k] = parseFloat(e.target.value); 
        const resetBtn = document.getElementById('btn-reset-real');
        if(resetBtn) resetBtn.style.display = 'block';
        buildPlant(); 
        updateUI();
    }

    const bind = (id, k) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.addEventListener('input', e => SimulasiManual(e, k));
    };
    bind('slider-age', 'age');
    bind('slider-moisture', 'moisture');
    bind('slider-atemp', 'atemp');
    bind('slider-humi', 'humi');
    bind('slider-tds', 'tds');
    bind('slider-light', 'light');
    bind('slider-wtemp', 'wtemp');



    const dateInput = document.getElementById('input-planting-date');
    if(dateInput) {
        dateInput.addEventListener('click', () => {
            try { dateInput.showPicker(); } catch (err) {}
        });
        // --- FUNGSI CLASS DIAGRAM ---
        async function AturTanggalTanam(e) {
            const val = e.target.value;
            localStorage.setItem('planting_date', val);
            updateAgeFromPlantingDate(val);
            const token = localStorage.getItem('jwt_token');
            if (token) {
                try {
                    await fetch('/api/user/settings', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ planting_date: val })
                    });
                } catch (err) {}
            }
        }
        
        dateInput.addEventListener('change', AturTanggalTanam);
        
        const savedDate = localStorage.getItem('planting_date');
        if (savedDate) {
            dateInput.value = savedDate;
            updateAgeFromPlantingDate(savedDate);
        } else {
            const defaultDate = new Date();
            defaultDate.setDate(defaultDate.getDate() - 60);
            const yyyy = defaultDate.getFullYear();
            const mm = String(defaultDate.getMonth() + 1).padStart(2, '0');
            const dd = String(defaultDate.getDate()).padStart(2, '0');
            const formattedDate = `${yyyy}-${mm}-${dd}`;
            dateInput.value = formattedDate;
            localStorage.setItem('planting_date', formattedDate);
            updateAgeFromPlantingDate(formattedDate);
        }
    }

    // --- FUNGSI CLASS DIAGRAM ---
    function ToggleTanah(e) {
        e.target.classList.toggle('active');
        toggleSoil(e.target.classList.contains('active'));
    }

    const toggleBtn = document.getElementById('toggle-soil');
    if(toggleBtn) {
        toggleBtn.addEventListener('click', ToggleTanah);
    }

    const resetCamBtn = document.getElementById('reset-cam');
    if(resetCamBtn) {
        resetCamBtn.addEventListener('click', () => resetCamera());
    }

    // --- FUNGSI CLASS DIAGRAM ---
    function ResetKeDataRiil() {
        S.moisture = realData.moisture;
        S.tds = realData.tds;
        S.light = realData.light;
        S.atemp = realData.atemp;
        S.humi = realData.humi;
        S.wtemp = realData.wtemp;
        S.battery = realData.battery;
        S.sensor_status = realData.sensor_status;

        const savedDate = localStorage.getItem('planting_date');
        const dateInput = document.getElementById('input-planting-date');
        
        if (savedDate) {
            updateAgeFromPlantingDate(savedDate);
        } else if (dateInput && dateInput.value) {
            updateAgeFromPlantingDate(dateInput.value);
        }

        document.getElementById('slider-moisture').value = S.moisture;
        document.getElementById('slider-tds').value = S.tds;
        document.getElementById('slider-light').value = S.light;
        document.getElementById('slider-atemp').value = S.atemp;
        document.getElementById('slider-humi').value = S.humi;
        document.getElementById('slider-wtemp').value = S.wtemp;

        buildPlant();
        updateUI();
        
        const espOnline = AppState.deviceStatus.includes("ONLINE");
        const espOffline = AppState.deviceStatus.includes("DEEP SLEEP");
        updateDeviceStatus(espOnline ? "online" : (espOffline ? "offline" : "waiting"));
        updateHealthUI(S.battery, S.sensor_status);
        
        const btnResetReal = document.getElementById('btn-reset-real');
        if (btnResetReal) btnResetReal.style.display = 'none';
    }

    const btnResetReal = document.getElementById('btn-reset-real');
    if(btnResetReal) {
        btnResetReal.addEventListener('click', ResetKeDataRiil);
    }
    
    // Set status awal ke waiting (menunggu data GPRS)
    updateDeviceStatus("waiting");
    updateHealthUI("waiting", "waiting");
}
