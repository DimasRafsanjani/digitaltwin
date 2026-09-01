const crypto = require('crypto');
const http = require('http');
const https = require('https');

const SECRET_KEY = "TwinSecr3tK3y_2026";
const PORT = 3000;
const HOST = "localhost";

// Konfigurasi Siklus Simulasi Deep Sleep (dipercepat untuk keperluan demonstrasi sidang)
const WAKE_DURATION_MS = 15000;  // Simulasi alat menyala selama 15 detik (Kirim Data)
const SLEEP_DURATION_MS = 600000; // Simulasi alat Deep Sleep selama 10 Menit (600 detik)

console.log("=== SIMULATOR MODE DEEP SLEEP (UNTUK DEMO SIDANG) ===");
console.log(`Mensimulasikan siklus hemat baterai ESP32...`);
console.log(`- Alat akan BANGUN (Aktif) & Mengirim data.`);
console.log(`- Alat akan TIDUR (Deep Sleep) selama ${SLEEP_DURATION_MS / 1000} detik.`);
console.log("Tujuan: Mengubah status dasbor web dari ONLINE menjadi DEEP SLEEP secara bergantian.");
console.log("Tekan Ctrl+C untuk menghentikan simulator.\n");

function getRandom(min, max, decimals = 1) {
  const rand = Math.random() * (max - min) + min;
  return parseFloat(rand.toFixed(decimals));
}

function sendSimulatedData() {
  console.log(`\n[ESP32 WAKE UP] Bangun dari Deep Sleep. Membaca Sensor...`);
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

  const messageToSign = `${timestamp}:${payload.suhu_udara.toFixed(1)}:${payload.kelembapan_udara.toFixed(1)}:${payload.suhu_air.toFixed(1)}:${parseInt(payload.kelembapan_tanah)}:${parseInt(payload.tds_nutrisi)}:${payload.intensitas_cahaya.toFixed(1)}:${parseInt(payload.baterai)}:1`;

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

  const req = (PORT === 443 ? https : http).request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`[${new Date().toLocaleTimeString()}] Data terkirim (Status: ${res.statusCode}).`);

      // Setelah data terkirim, masuk ke mode Deep Sleep
      console.log(`[ESP32 SLEEPING] Masuk mode hemat daya selama ${SLEEP_DURATION_MS / 1000} detik...`);
      setTimeout(sendSimulatedData, SLEEP_DURATION_MS);
    });
  });

  req.on('error', (e) => {
    console.error(`[ERROR] Gagal mengirim data: ${e.message}`);
    // Jika gagal, tetap coba bangun lagi sesuai siklus
    setTimeout(sendSimulatedData, SLEEP_DURATION_MS);
  });

  req.write(body);
  req.end();
}

// Jalankan siklus pertama kali
sendSimulatedData();
