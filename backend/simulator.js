const crypto = require('crypto');
const http = require('http');

const SECRET_KEY = "TwinSecr3tK3y_2026";
const PORT = 3000;
const HOST = "localhost";

// Konfigurasi Interval (Dibuat singkat 10 detik untuk keperluan demo/sidang)
const INTERVAL_MS = 10000; 

console.log("=== SIMULATOR NODE SENSOR IOT SAWAH ===");
console.log(`Mengirim data sensor tiruan ke http://${HOST}:${PORT}/api/sensor setiap ${INTERVAL_MS / 1000} detik...`);
console.log("Tekan Ctrl+C untuk menghentikan simulator.\n");

function getRandom(min, max, decimals = 1) {
  const rand = Math.random() * (max - min) + min;
  return parseFloat(rand.toFixed(decimals));
}

function sendSimulatedData() {
  const timestamp = Math.floor(Date.now() / 1000);

  // Data sensor tiruan (ESP32 aktif, sensor sehat, baterai 60-80%)
  const payload = {
    suhu_udara: getRandom(24.0, 31.0, 1),
    kelembapan_udara: getRandom(55.0, 75.0, 1),
    suhu_air: getRandom(23.0, 27.0, 1),
    kelembapan_tanah: Math.floor(getRandom(65, 85, 0)),
    tds_nutrisi: Math.floor(getRandom(500, 750, 0)),
    intensitas_cahaya: getRandom(8000, 18000, 1),
    baterai: Math.floor(getRandom(60, 80, 0)), // Baterai 60-80%
    sensor_status: true // Sensor Aktif/Sehat
  };

  // Format pesan mentah untuk tanda tangan HMAC
  // format: timestamp:suhu_udara:kelembapan_udara:suhu_air:kelembapan_tanah:tds_nutrisi:intensitas_cahaya:baterai:sensor_status
  const messageToSign = `${timestamp}:${payload.suhu_udara.toFixed(1)}:${payload.kelembapan_udara.toFixed(1)}:${payload.suhu_air.toFixed(1)}:${parseInt(payload.kelembapan_tanah)}:${parseInt(payload.tds_nutrisi)}:${payload.intensitas_cahaya.toFixed(1)}:${parseInt(payload.baterai)}:1`;

  // Hitung HMAC-SHA256
  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(messageToSign)
    .digest('hex');

  const body = JSON.stringify(payload);

  const options = {
    hostname: HOST,
    port: PORT,
    path: '/api/sensor',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Signature': signature,
      'X-Timestamp': timestamp
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`[${new Date().toLocaleTimeString()}] Kirim data: Baterai=${payload.baterai}%, Tanah=${payload.kelembapan_tanah}%, TDS=${payload.tds_nutrisi} ppm | Response: ${res.statusCode} (${data.trim()})`);
    });
  });

  req.on('error', (e) => {
    console.error(`[ERROR] Gagal mengirim data ke server backend: ${e.message}`);
    console.error("Pastikan backend server Express (server.js) sudah dijalankan pada port 3000.");
  });

  req.write(body);
  req.end();
}

// Jalankan pengiriman pertama kali langsung, lalu berulang setiap interval
sendSimulatedData();
setInterval(sendSimulatedData, INTERVAL_MS);
