import { S, realData, AppState, PredictiveState } from './state.js';
import { buildPlant, toggleSoil, resetCamera } from './3d-engine.js';

let hasAlertedHarvest = false;

// --- SISTEM TOAST NOTIFICATION ---
export function showNotification(message, type = "info") {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    
    let icon = "ℹ️";
    if (type === "error") icon = "🚨";
    else if (type === "warning") icon = "⚠️";
    else if (type === "success") icon = "✅";

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.transition = "opacity 0.5s, transform 0.5s";
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-20px)";
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

// --- UPDATE KUOTA SIM & BANDWIDTH ---
export function updateQuotaUI(stats) {
    const quotaEl = document.getElementById('val-quota');
    const subEl = document.getElementById('val-quota-sub');
    if (!quotaEl) return;

    if (stats) {
        const totalQuotaMB = AppState.totalQuotaMB || 5120;
        const usedMB = (Number(stats.total_usage_kb) || 0) / 1024;
        const remainingMB = Math.max(0, totalQuotaMB - usedMB);
        const remainingGB = (remainingMB / 1024).toFixed(2);

        quotaEl.innerText = `${remainingGB} GB`;
        if (subEl) {
            subEl.innerText = `Hari ini: ${stats.today_usage_kb} KB (${stats.today_transmissions} pkt)`;
        }

        // Alert jika kuota < 10%
        if (remainingMB / totalQuotaMB < 0.10 && !AppState.activeAlerts.has("quota_low")) {
            showNotification(`Peringatan: Kuota SIM Card IoT Sisa ${remainingGB} GB (<10%)!`, "warning");
            AppState.activeAlerts.add("quota_low");
        }
    }
}

// --- KALKULASI PROYEKSI PERTUMBUHAN (PREDICTIVE TWIN) ---
export function hitungPrediksiPertumbuhan() {
    const dateInput = document.getElementById('pred-target-date');
    const nutrientInput = document.getElementById('pred-nutrient-scenario');
    const waterInput = document.getElementById('pred-water-scenario');

    const plantingDateStr = localStorage.getItem('planting_date');
    if (!dateInput || !nutrientInput || !waterInput || !plantingDateStr) return;

    const plantingDate = new Date(plantingDateStr);
    const targetDate = new Date(dateInput.value || new Date());
    
    // Hitung HST target
    const diffTime = targetDate.getTime() - plantingDate.getTime();
    let targetHST = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    targetHST = Math.max(1, Math.min(targetHST, 120));

    const nutrient = nutrientInput.value;
    const water = waterInput.value;

    // 1. Multiplier faktor nutrisi
    let nutFactor = 1.0;
    if (nutrient === "low") nutFactor = 0.65;
    else if (nutrient === "excess") nutFactor = 0.90;

    // 2. Multiplier faktor air
    let waterFactor = 1.0;
    if (water === "dry") waterFactor = 0.6;
    else if (water === "flooded") waterFactor = 0.95;

    // 3. Formula Sigmoid Logistik Tinggi Tanaman Padi (H_max = 110 cm)
    const sigmoid = 110 / (1 + Math.exp(-0.075 * (targetHST - 45)));
    const estimatedHeightCm = Math.round(sigmoid * nutFactor * waterFactor);

    // 4. Formula Estimasi Anakan (Tillers)
    let maxTillers = nutrient === "low" ? 4 : (nutrient === "excess" ? 12 : 8);
    if (water === "dry") maxTillers = Math.max(1, maxTillers - 3);
    const estimatedTillers = Math.min(maxTillers, Math.max(1, Math.floor((targetHST / 45) * maxTillers)));

    // 5. Penentuan Fase
    let growthPhase = "Fase Vegetatif Awal";
    if (targetHST >= 85) growthPhase = "Fase Pematangan Bulir (Siap Panen)";
    else if (targetHST >= 60) growthPhase = "Fase Reproduktif (Berbunga/Malai)";
    else if (targetHST >= 25) growthPhase = "Fase Vegetatif Aktif (Anakan)";

    // Update Text UI di Hasil Prediksi
    const resAge = document.getElementById('pred-res-age');
    const resHeight = document.getElementById('pred-res-height');
    const resTillers = document.getElementById('pred-res-tillers');
    const resPhase = document.getElementById('pred-res-phase');

    if (resAge) resAge.innerText = `${targetHST} HST`;
    if (resHeight) resHeight.innerText = `~${estimatedHeightCm} cm`;
    if (resTillers) resTillers.innerText = `~${estimatedTillers} Batang`;
    if (resPhase) {
        let statusKualitas = nutrient === "low" ? " (Klorosis/Kuning)" : (water === "dry" ? " (Layu Air)" : " (Optimal)");
        resPhase.innerText = growthPhase + statusKualitas;
    }

    PredictiveState.targetHST = targetHST;
    PredictiveState.nutrientScenario = nutrient;
    PredictiveState.irrigationScenario = water;
}

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
            espStatus.innerText = "Online (Aktif)";
            espStatus.style.color = "#4ade80";
        }
    } else if (status === "deepsleep") {
        AppState.deviceStatus = "Alat: DEEP SLEEP";
        badge.style.background = "#f59e0b";
        badge.style.color = "#000";
        if(espStatus) {
            espStatus.innerText = "Deep Sleep (Hemat Daya)";
            espStatus.style.color = "#f59e0b";
        }
    } else if (status === "offline" || status === false) {
        AppState.deviceStatus = "Alat: OFFLINE";
        badge.style.background = "#ef4444";
        badge.style.color = "#fff";
        if(espStatus) {
            espStatus.innerText = "Offline (Mati / Putus)";
            espStatus.style.color = "#ef4444";
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
            sensEl.innerText = "Normal (Aktif)";
            sensEl.style.color = "#4ade80";
        } else {
            sensEl.innerText = "Rusak / Mati";
            sensEl.style.color = "#ef4444"; // Red
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
    calculatedAge = Math.max(1, Math.min(calculatedAge, 120));
    
    S.age = calculatedAge;
    const slider = document.getElementById('slider-age');
    if(slider) slider.value = calculatedAge;
    buildPlant();
    updateUI();
    hitungPrediksiPertumbuhan();
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

    // --- INISIALISASI PREDICTIVE TWIN (REVISI SIDANG POIN 1) ---
    const predDate = document.getElementById('pred-target-date');
    if (predDate) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
        const yyyy = futureDate.getFullYear();
        const mm = String(futureDate.getMonth() + 1).padStart(2, '0');
        const dd = String(futureDate.getDate()).padStart(2, '0');
        predDate.value = `${yyyy}-${mm}-${dd}`;
        
        predDate.addEventListener('change', hitungPrediksiPertumbuhan);
        document.getElementById('pred-nutrient-scenario')?.addEventListener('change', hitungPrediksiPertumbuhan);
        document.getElementById('pred-water-scenario')?.addEventListener('change', hitungPrediksiPertumbuhan);

        hitungPrediksiPertumbuhan();

        // Tombol Terapkan ke 3D Twin
        document.getElementById('btn-apply-prediction')?.addEventListener('click', () => {
            const nutrient = document.getElementById('pred-nutrient-scenario').value;
            const water = document.getElementById('pred-water-scenario').value;

            S.age = PredictiveState.targetHST;
            if (nutrient === "low") S.tds = 300;
            else if (nutrient === "excess") S.tds = 1800;
            else S.tds = 750;

            if (water === "dry") {
                S.moisture = 35;
                S.wiltStressLevel = 1.0;
            } else if (water === "flooded") {
                S.moisture = 100;
                S.wiltStressLevel = 0.0;
            } else {
                S.moisture = 80;
                S.wiltStressLevel = 0.0;
            }

            document.getElementById('btn-reset-real').style.display = 'block';
            document.getElementById('slider-age').value = S.age;
            document.getElementById('slider-tds').value = S.tds;
            document.getElementById('slider-moisture').value = S.moisture;

            buildPlant();
            updateUI();
            showNotification(`Model 3D diproyeksikan ke ${S.age} HST (${nutrient} nutrient, ${water} water)!`, "success");
        });
    }

    // --- MODAL & BACKUP DATABASE RECOVERY (REVISI SIDANG POIN 3) ---
    const modalDb = document.getElementById('db-modal');
    document.getElementById('btn-open-db-modal')?.addEventListener('click', () => {
        if (modalDb) modalDb.style.display = 'flex';
        loadWhatsAppStatus();
    });
    document.getElementById('btn-close-db-modal')?.addEventListener('click', () => {
        if (modalDb) modalDb.style.display = 'none';
    });

    // Download Backup
    document.getElementById('btn-download-backup')?.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/admin/backup');
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `backup_rice_twin_${Date.now()}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                showNotification("Database snapshot berhasil diunduh!", "success");
            } else {
                showNotification("Gagal mengunduh backup database.", "error");
            }
        } catch (e) {
            showNotification("Error downloading backup: " + e.message, "error");
        }
    });

    // Restore Database
    document.getElementById('btn-execute-restore')?.addEventListener('click', async () => {
        const fileInput = document.getElementById('input-restore-file');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            alert("Silakan pilih file backup (.json) terlebih dahulu.");
            return;
        }

        if (!confirm("PERINGATAN: Memulihkan database akan menimpa log data yang ada saat ini dengan data backup. Lanjutkan?")) {
            return;
        }

        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const backupJson = JSON.parse(event.target.result);
                const res = await fetch('/api/admin/restore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(backupJson)
                });
                const result = await res.json();
                if (res.ok) {
                    showNotification(`Database dipulihkan: ${result.restored_logs} log sensor!`, "success");
                    setTimeout(() => window.location.reload(), 1500);
                } else {
                    showNotification("Gagal memulihkan database: " + result.error, "error");
                }
            } catch (err) {
                showNotification("File JSON tidak valid: " + err.message, "error");
            }
        };
        reader.readAsText(file);
    });

    // --- WHATSAPP GATEWAY MODAL LOGIC ---
    async function loadWhatsAppStatus() {
        try {
            const res = await fetch('/api/admin/wa/status');
            if (res.ok) {
                const data = await res.json();
                const connBadge = document.getElementById('wa-conn-status');
                const phoneInput = document.getElementById('input-wa-phone');
                if (connBadge) {
                    if (data.connected) {
                        connBadge.innerText = "Terhubung";
                        connBadge.style.background = "#14532d";
                        connBadge.style.color = "#4ade80";
                    } else {
                        connBadge.innerText = "Belum Terhubung";
                        connBadge.style.background = "#78350f";
                        connBadge.style.color = "#fbbf24";
                    }
                }
                if (phoneInput && data.targetPhone && !phoneInput.value) {
                    phoneInput.value = data.targetPhone;
                }
            }
        } catch (e) {}
    }

    document.getElementById('btn-save-wa-phone')?.addEventListener('click', async () => {
        const phone = document.getElementById('input-wa-phone')?.value.trim();
        if (!phone) {
            alert("Silakan masukkan nomor WhatsApp tujuan.");
            return;
        }
        try {
            const res = await fetch('/api/admin/wa/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const data = await res.json();
            if (res.ok) {
                showNotification("Nomor WhatsApp berhasil disimpan: " + data.targetPhone, "success");
            } else {
                showNotification(data.error || "Gagal menyimpan nomor.", "error");
            }
        } catch (e) {
            showNotification("Error: " + e.message, "error");
        }
    });

    document.getElementById('btn-test-wa')?.addEventListener('click', async () => {
        showNotification("Mengirim pesan tes WhatsApp...", "info");
        try {
            const res = await fetch('/api/admin/wa/test', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                showNotification(data.message, "success");
            } else {
                showNotification(data.error || "Gagal kirim pesan WhatsApp.", "error");
            }
        } catch (e) {
            showNotification("Error: " + e.message, "error");
        }
    });

    document.getElementById('btn-reset-wa')?.addEventListener('click', async () => {
        if (confirm("Reset sesi WhatsApp untuk memunculkan QR Code baru di terminal?")) {
            try {
                const res = await fetch('/api/admin/wa/reset', { method: 'POST' });
                const data = await res.json();
                showNotification(data.message || "Sesi WhatsApp di-reset. Cek terminal!", "info");
                setTimeout(loadWhatsAppStatus, 2000);
            } catch (e) {
                showNotification("Error: " + e.message, "error");
            }
        }
    });

    // Toggle Tanah
    const toggleBtn = document.getElementById('toggle-soil');
    if(toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.target.classList.toggle('active');
            toggleSoil(e.target.classList.contains('active'));
        });
    }

    // Reset Camera
    const resetCamBtn = document.getElementById('reset-cam');
    if(resetCamBtn) {
        resetCamBtn.addEventListener('click', () => resetCamera());
    }

    // Reset ke Data Riil
    function ResetKeDataRiil() {
        S.moisture = realData.moisture;
        S.tds = realData.tds;
        S.light = realData.light;
        S.atemp = realData.atemp;
        S.humi = realData.humi;
        S.wtemp = realData.wtemp;
        S.battery = realData.battery;
        S.sensor_status = realData.sensor_status;
        S.wiltStressLevel = 0;

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
        showNotification("Kembali ke data sensor real-time.", "info");
    }

    const btnResetReal = document.getElementById('btn-reset-real');
    if(btnResetReal) {
        btnResetReal.addEventListener('click', ResetKeDataRiil);
    }
    
    // Set status awal
    updateDeviceStatus("waiting");
    updateHealthUI("waiting", "waiting");
}

