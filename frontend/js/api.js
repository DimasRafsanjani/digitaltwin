import { S, realData, AppState, SensorHistory } from './state.js';
import { updateDeviceStatus, updateUI, updateAgeFromPlantingDate, updateHealthUI, updateLastTimestamp, showNotification, updateQuotaUI } from './ui.js';
import { buildPlant } from './3d-engine.js';

let socket;

// --- FUNGSI DATA SMOOTHING (MOVING AVERAGE FILTER) ---
function hitungMovingAverage(baru) {
    SensorHistory.history.push({ ...baru });
    if (SensorHistory.history.length > SensorHistory.bufferSize) {
        SensorHistory.history.shift();
    }
    const len = SensorHistory.history.length;
    const avg = {
        moisture: Math.round(SensorHistory.history.reduce((a, c) => a + c.moisture, 0) / len),
        tds: Math.round(SensorHistory.history.reduce((a, c) => a + c.tds, 0) / len),
        light: Math.round(SensorHistory.history.reduce((a, c) => a + c.light, 0) / len),
        atemp: parseFloat((SensorHistory.history.reduce((a, c) => a + c.atemp, 0) / len).toFixed(1)),
        humi: parseFloat((SensorHistory.history.reduce((a, c) => a + c.humi, 0) / len).toFixed(1)),
        wtemp: parseFloat((SensorHistory.history.reduce((a, c) => a + c.wtemp, 0) / len).toFixed(1))
    };
    return avg;
}

// --- FUNGSI CUMULATIVE PLANT STRESS (PSI) ---
let droughtCycleCount = 0;
function hitungStressKumulatif(smoothedMoisture) {
    if (smoothedMoisture < 45) {
        droughtCycleCount = Math.min(droughtCycleCount + 1, 10);
    } else {
        droughtCycleCount = Math.max(droughtCycleCount - 1, 0);
    }
    const stressRatio = droughtCycleCount / 4.0;
    return Math.min(1.0, Math.max(0.0, stressRatio));
}

export function initWebSocket() {
    const token = localStorage.getItem('jwt_token');
    if (!token) return;

    socket = window.io({
        auth: { token }
    });

    socket.on("connect", () => {
        console.log("[WS] Terhubung ke server WebSocket!");
    });

    socket.on("disconnect", () => {
        console.log("[WS] Koneksi WebSocket terputus.");
        updateDeviceStatus(false);
        showNotification("Koneksi server terputus.", "warning");
    });

    socket.on("connect_error", (err) => {
        console.log("[WS] Autentikasi gagal:", err.message);
        if (err.message.includes("Authentication error")) {
            localStorage.removeItem('jwt_token');
            const overlay = document.getElementById('login-overlay');
            if (overlay) overlay.style.display = 'flex';
        }
    });

    socket.on("sensorUpdate", LihatMonitoring);
}

// --- FUNGSI CLASS DIAGRAM ---
export function LihatMonitoring(data) {
    const timestamp = data.timestamp || (data.created_at ? data.created_at.replace(" ", "T") + "Z" : null);

    // Hitung usia data terakhir (dalam detik)
    const dataTime = timestamp ? new Date(timestamp).getTime() : Date.now();
    const ageSeconds = Math.max(0, Math.floor((Date.now() - dataTime) / 1000));

    clearTimeout(AppState.deviceTimeout);
    clearTimeout(AppState.offlineTimeout);

    updateLastTimestamp(timestamp);

    if (ageSeconds < 15) {
        // 1. Data segar (< 15 detik) -> Status ONLINE (Hijau)
        updateDeviceStatus("online", timestamp);

        // Setelah sisa waktu menyala (15 detik) habis -> Beralih ke DEEP SLEEP (Oranye)
        const remainingWakeMs = Math.max(1000, (15 - ageSeconds) * 1000);
        AppState.deviceTimeout = setTimeout(() => {
            updateDeviceStatus("deepsleep");
            showNotification("Node ESP32 masuk mode Deep Sleep (hemat daya).", "info");
        }, remainingWakeMs);

        // Jika lewat 15 menit (900 detik) tidak ada data baru -> Beralih ke OFFLINE (Merah)
        AppState.offlineTimeout = setTimeout(() => {
            updateDeviceStatus("offline");
            showNotification("Peringatan: Node ESP32 OFFLINE (melebihi siklus Deep Sleep)!", "error");
        }, 900000);
    } else if (ageSeconds <= 900) {
        // 2. Data berusia antara 15 detik s/d 15 menit -> Status DEEP SLEEP (Oranye)
        updateDeviceStatus("deepsleep");
        
        // Pasang timer sisa waktu sebelum dinyatakan OFFLINE
        const remainingOfflineMs = Math.max(1000, (900 - ageSeconds) * 1000);
        AppState.offlineTimeout = setTimeout(() => {
            updateDeviceStatus("offline");
            showNotification("Peringatan: Node ESP32 OFFLINE (melebihi siklus Deep Sleep)!", "error");
        }, remainingOfflineMs);
    } else {
        // 3. Data sudah lebih dari 15 menit -> Status OFFLINE (Merah)
        updateDeviceStatus("offline");
    }

    console.log("[WS] Menerima data sensor baru dari server:", data);

    realData.moisture = Number(data.kelembapan_tanah) || 0;
    realData.tds = Number(data.tds_nutrisi) || 0;
    realData.light = Number(data.intensitas_cahaya) || 0;
    realData.atemp = Number(data.suhu_udara) || 0;
    realData.humi = Number(data.kelembapan_udara) || 0;
    realData.wtemp = Number(data.suhu_air) || 0;
    realData.battery = data.baterai !== undefined ? Number(data.baterai) : 100;
    realData.sensor_status = data.sensor_status;

    const smoothed = hitungMovingAverage(realData);
    const wiltStress = hitungStressKumulatif(smoothed.moisture);

    if (realData.battery < 20 && !AppState.activeAlerts.has("battery_low")) {
        showNotification(`Peringatan: Daya Baterai Node Sawah Rendah (${realData.battery}%)!`, "error");
        AppState.activeAlerts.add("battery_low");
    } else if (realData.battery >= 25) {
        AppState.activeAlerts.delete("battery_low");
    }

    if (realData.moisture < 45 && !AppState.activeAlerts.has("drought")) {
        showNotification(`Peringatan: Kondisi Tanah Kekeringan (${realData.moisture}%)! Segera aktifkan irigasi.`, "warning");
        AppState.activeAlerts.add("drought");
    } else if (realData.moisture >= 50) {
        AppState.activeAlerts.delete("drought");
    }

    if (data.sisa_kuota_mb !== undefined) {
        const quotaGB = (Number(data.sisa_kuota_mb) / 1024).toFixed(2);
        const quotaEl = document.getElementById('val-quota');
        if (quotaEl) {
            quotaEl.innerText = `${quotaGB} GB`;
            quotaEl.style.color = Number(data.sisa_kuota_mb) < 500 ? "#ef4444" : "#38bdf8";
        }
        if (Number(data.sisa_kuota_mb) < 500 && !AppState.activeAlerts.has("quota_low")) {
            showNotification(`Peringatan: Sisa Kuota SIM Card Kritis (${data.sisa_kuota_mb} MB)!`, "warning");
            AppState.activeAlerts.add("quota_low");
        } else if (Number(data.sisa_kuota_mb) >= 500) {
            AppState.activeAlerts.delete("quota_low");
        }
    }

    if ((realData.sensor_status === false || realData.sensor_status === 0 || realData.sensor_status === "0") && !AppState.activeAlerts.has("sensor_error")) {
        showNotification("Peringatan: Anomali/Kerusakan terdeteksi pada sensor!", "error");
        AppState.activeAlerts.add("sensor_error");
    } else if (realData.sensor_status === true || realData.sensor_status === 1) {
        AppState.activeAlerts.delete("sensor_error");
    }

    const isSimulation = document.getElementById('btn-reset-real')?.style.display === 'block';
    if (!isSimulation) {
        S.moisture = smoothed.moisture;
        S.tds = smoothed.tds;
        S.light = smoothed.light;
        S.atemp = smoothed.atemp;
        S.humi = smoothed.humi;
        S.wtemp = smoothed.wtemp;
        S.battery = realData.battery;
        S.sensor_status = realData.sensor_status;
        S.wiltStressLevel = wiltStress;

        buildPlant();
        updateUI();
        updateHealthUI(S.battery, S.sensor_status);

        const sliderM = document.getElementById('slider-moisture');
        if (sliderM) sliderM.value = S.moisture;
        const sliderT = document.getElementById('slider-tds');
        if (sliderT) sliderT.value = S.tds;
        const sliderL = document.getElementById('slider-light');
        if (sliderL) sliderL.value = S.light;
        const sliderA = document.getElementById('slider-atemp');
        if (sliderA) sliderA.value = S.atemp;
        const sliderH = document.getElementById('slider-humi');
        if (sliderH) sliderH.value = S.humi;
        const sliderW = document.getElementById('slider-wtemp');
        if (sliderW) sliderW.value = S.wtemp;
    }

    fetchDataUsage();
}

export async function fetchDataUsage() {
    try {
        const res = await fetch('/api/admin/data-usage');
        if (res.ok) {
            const stats = await res.json();
            updateQuotaUI(stats);
        }
    } catch (e) {
        console.error("Gagal mengambil data usage:", e);
    }
}

export async function checkAuth() {
    const token = localStorage.getItem('jwt_token');
    if (token) {
        initWebSocket();
        try {
            const res = await fetch('/api/user/settings', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.planting_date) {
                    localStorage.setItem('planting_date', data.planting_date);
                    const dateInput = document.getElementById('input-planting-date');
                    if (dateInput) dateInput.value = data.planting_date;
                    updateAgeFromPlantingDate(data.planting_date);
                }
            }

            const resSensor = await fetch('/api/sensor/latest');
            if (resSensor.ok) {
                const latestData = await resSensor.json();
                if (latestData && latestData.kelembapan_tanah !== undefined) {
                    LihatMonitoring(latestData);
                }
            }

            fetchDataUsage();
        } catch (err) {
            console.error("[API] Gagal mengambil data awal:", err);
        }
    } else {
        window.location.href = '/login.html';
    }
}
