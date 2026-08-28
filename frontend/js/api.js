import { S, realData, AppState } from './state.js';
import { updateDeviceStatus, updateUI, updateAgeFromPlantingDate, updateHealthUI, updateLastTimestamp } from './ui.js';
import { buildPlant } from './3d-engine.js';

let socket;

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

    updateDeviceStatus(true, timestamp);
    updateLastTimestamp(timestamp);

    clearTimeout(AppState.deviceTimeout);
    AppState.deviceTimeout = setTimeout(() => {
        updateDeviceStatus(false);
    }, 15000); // 15 detik sesuai pengujian di skripsi

    console.log("[WS] Menerima data sensor baru dari server:", data);

    realData.moisture = data.kelembapan_tanah;
    realData.tds = data.tds_nutrisi;
    realData.light = data.intensitas_cahaya;
    realData.atemp = data.suhu_udara;
    realData.humi = data.kelembapan_udara;
    realData.wtemp = data.suhu_air;
    realData.battery = data.baterai;
    realData.sensor_status = data.sensor_status;

    const isSimulation = document.getElementById('btn-reset-real').style.display === 'block';
    if (!isSimulation) {
        S.moisture = realData.moisture;
        S.tds = realData.tds;
        S.light = realData.light;
        S.atemp = realData.atemp;
        S.humi = realData.humi;
        S.wtemp = realData.wtemp;
        S.battery = realData.battery;
        S.sensor_status = realData.sensor_status;

        buildPlant();
        updateUI();
        updateHealthUI(S.battery, S.sensor_status);

        document.getElementById('slider-moisture').value = S.moisture;
        document.getElementById('slider-tds').value = S.tds;
        document.getElementById('slider-light').value = S.light;
        document.getElementById('slider-atemp').value = S.atemp;
        document.getElementById('slider-humi').value = S.humi;
        document.getElementById('slider-wtemp').value = S.wtemp;
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

            // Fetch data terakhir agar model langsung muncul meskipun alat sedang offline
            const resSensor = await fetch('/api/sensor/latest');
            if (resSensor.ok) {
                const latestData = await resSensor.json();
                if (latestData && latestData.kelembapan_tanah !== undefined) {
                    LihatMonitoring(latestData);
                }
            }
        } catch (err) {
            console.error("[API] Gagal mengambil data awal:", err);
        }
    } else {
        window.location.href = '/login.html';
    }
}
