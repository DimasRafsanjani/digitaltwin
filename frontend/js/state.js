// --- Sensor State (Active visual state shown on dashboard) ---
export const S = {
    moisture: 85,
    tds: 600,
    light: 12000,
    atemp: 28,
    humi: 65,
    wtemp: 26,
    age: 60,
    roots: true
};

// --- Last Known Real-Time Sensor Data from ESP32 ---
export const realData = {
    moisture: 85,
    tds: 600,
    light: 12000,
    atemp: 28,
    humi: 65,
    wtemp: 26
};

// --- Global UI State ---
export const AppState = {
    deviceStatus: "Menunggu Data...",
    deviceTimeout: null
};
