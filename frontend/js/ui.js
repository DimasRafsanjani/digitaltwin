import { S, realData } from './state.js';
import { buildPlant, toggleSoil, resetCamera } from './3d-engine.js';

export function updateDeviceStatus(isOnline) {
    const badge = document.getElementById('stage-display');
    if (!badge) return;
    
    // We already update AppState in api.js, here we just read it or pass it.
    // Actually api.js passes isOnline and updates AppState.deviceStatus. We can handle DOM here.
    if (isOnline) {
        badge.style.background = "#3cf08d";
        badge.style.color = "#000";
    } else {
        badge.style.background = "#ff5252";
        badge.style.color = "#fff";
    }
    const phase = S.age >= 90 ? "Fase Pematangan" : (S.age >= 60 ? "Fase Reproduktif" : "Fase Vegetatif");
    // Get device status from badge string replacement will be handled in buildPlant, but we can just update it here.
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
    const bind = (id, k) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.addEventListener('input', e => {
            S[k] = parseFloat(e.target.value); 
            const resetBtn = document.getElementById('btn-reset-real');
            if(resetBtn) resetBtn.style.display = 'block';
            buildPlant(); 
            updateUI();
        });
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
        dateInput.addEventListener('change', async e => {
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
        });
        
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
            updateAgeFromPlantingDate(formattedDate);
        }
    }

    const toggleBtn = document.getElementById('toggle-soil');
    if(toggleBtn) {
        toggleBtn.addEventListener('click', e => {
            e.target.classList.toggle('active');
            toggleSoil(e.target.classList.contains('active'));
        });
    }

    const resetCamBtn = document.getElementById('reset-cam');
    if(resetCamBtn) {
        resetCamBtn.addEventListener('click', () => resetCamera());
    }

    const btnResetReal = document.getElementById('btn-reset-real');
    if(btnResetReal) {
        btnResetReal.addEventListener('click', () => {
            S.moisture = realData.moisture;
            S.tds = realData.tds;
            S.light = realData.light;
            S.atemp = realData.atemp;
            S.humi = realData.humi;
            S.wtemp = realData.wtemp;

            const savedDate = localStorage.getItem('planting_date');
            if (savedDate) {
                updateAgeFromPlantingDate(savedDate);
            }

            document.getElementById('slider-moisture').value = S.moisture;
            document.getElementById('slider-tds').value = S.tds;
            document.getElementById('slider-light').value = S.light;
            document.getElementById('slider-atemp').value = S.atemp;
            document.getElementById('slider-humi').value = S.humi;
            document.getElementById('slider-wtemp').value = S.wtemp;

            buildPlant();
            updateUI();
            btnResetReal.style.display = 'none';
        });
    }
}
