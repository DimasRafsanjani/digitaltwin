// --- Sensor State (Active visual state shown on dashboard) ---
export const S = {
    moisture: 85,
    tds: 600,
    light: 12000,
    atemp: 28,
    humi: 65,
    wtemp: 26,
    age: 60,
    roots: true,
    battery: 100,
    sensor_status: true,
    // Stress index kumulatif (0 - 1.0)
    wiltStressLevel: 0,
    chlorosisStressLevel: 0
};

// --- Last Known Real-Time Raw Sensor Data from ESP32 ---
export const realData = {
    moisture: 85,
    tds: 600,
    light: 12000,
    atemp: 28,
    humi: 65,
    wtemp: 26,
    battery: 100,
    sensor_status: true
};

// --- Moving Average History Buffer (untuk menyaring noise 10 menit) ---
export const SensorHistory = {
    bufferSize: 3, // 3 sampel moving average
    history: []
};

// --- Monotonic Growth State ---
export const GrowthState = {
    maxEstablishedHeight: 0,
    maxEstablishedTillers: 1
};

// --- Predictive Simulation Scenario ---
export const PredictiveState = {
    isActive: false,
    targetDate: null,
    targetHST: 60,
    nutrientScenario: "optimal", // "low", "optimal", "excess"
    irrigationScenario: "optimal", // "dry", "optimal", "flooded"
    estimatedHeightCm: 0,
    estimatedTillers: 0,
    growthPhase: "Fase Vegetatif",
    healthStatus: "Optimal"
};

// --- Global UI & Health State ---
export const AppState = {
    deviceStatus: "Menunggu Data...",
    deviceTimeout: null,
    totalQuotaMB: 5120, // 5 GB default SIM quota
    usedQuotaKB: 0,
    activeAlerts: new Set()
};

