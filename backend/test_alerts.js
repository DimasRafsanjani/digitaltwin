const http = require('http');
const crypto = require('crypto');

const SECRET_KEY = "TwinSecr3tK3y_2026";
const PORT = 3000;
const HOST = "localhost";

function sendPost(payload) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(payload);

    const isSensorActive = (payload.sensor_status === true || payload.sensor_status === "true" || payload.sensor_status === 1) ? "1" : "0";
    const messageToSign = `${timestamp}:${Number(payload.suhu_udara || 0).toFixed(1)}:${Number(payload.kelembapan_udara || 0).toFixed(1)}:${Number(payload.suhu_air || 0).toFixed(1)}:${parseInt(payload.kelembapan_tanah || 0)}:${parseInt(payload.tds_nutrisi || 0)}:${Number(payload.intensitas_cahaya || 0).toFixed(1)}:${parseInt(payload.baterai !== undefined ? payload.baterai : 100)}:${isSensorActive}`;

    const signature = crypto
      .createHmac('sha256', SECRET_KEY)
      .update(messageToSign)
      .digest('hex');

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
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
  const arg = (process.argv[2] || 'all').toLowerCase();

  console.log("=================================================");
  console.log("🧪 UJI COBA ALERT WHATSAPP & DASHBOARD");
  console.log("=================================================");

  // TEST 1: Simulasi Baterai Rendah (12%)
  if (arg === 'all' || arg === 'baterai' || arg === 'battery') {
    console.log("\n[1] Mengirim Data Simulasi BATERAI RENDAH (12%)...");
    const res1 = await sendPost({
      suhu_udara: 29.5,
      kelembapan_udara: 68.0,
      suhu_air: 26.0,
      kelembapan_tanah: 75.0,
      tds_nutrisi: 650,
      intensitas_cahaya: 15000,
      baterai: 12, // < 20%
      sensor_status: true
    });
    console.log(`-> Response Server: Status ${res1.statusCode}`);
    console.log("-> Periksa dasbor web (Baterai: 12%) & WhatsApp Anda!");
    if (arg === 'all') await sleep(3500);
  }

  // TEST 2: Simulasi Kekeringan Tanah (32%)
  if (arg === 'all' || arg === 'kering' || arg === 'drought' || arg === 'tanah') {
    console.log("\n[2] Mengirim Data Simulasi TANAH KEKERINGAN (32%)...");
    const res2 = await sendPost({
      suhu_udara: 32.0,
      kelembapan_udara: 50.0,
      suhu_air: 28.0,
      kelembapan_tanah: 32.0, // < 45%
      tds_nutrisi: 650,
      intensitas_cahaya: 25000,
      baterai: 85,
      sensor_status: true
    });
    console.log(`-> Response Server: Status ${res2.statusCode}`);
    console.log("-> Periksa dasbor web (Tanah: 32%) & WhatsApp Anda!");
    if (arg === 'all') await sleep(3500);
  }

  // TEST 3: Simulasi Sisa Kuota SIM Menipis (120 MB / < 500 MB)
  if (arg === 'all' || arg === 'kuota' || arg === 'quota') {
    console.log("\n[3] Mengirim Data Simulasi KUOTA SIM MENIPIS (120 MB)...");
    const res3 = await sendPost({
      suhu_udara: 28.0,
      kelembapan_udara: 65.0,
      suhu_air: 26.0,
      kelembapan_tanah: 70.0,
      tds_nutrisi: 600,
      intensitas_cahaya: 12000,
      baterai: 90,
      sisa_kuota_mb: 120, // < 500 MB (< 10%)
      sensor_status: true
    });
    console.log(`-> Response Server: Status ${res3.statusCode}`);
    console.log("-> Periksa dasbor web (Kuota: 0.12 GB) & WhatsApp Anda!");
    if (arg === 'all') await sleep(3500);
  }

  // TEST 4: Simulasi Sensor Hardware Rusak / Mati (sensor_status: false)
  if (arg === 'all' || arg === 'sensor') {
    console.log("\n[4] Mengirim Data Simulasi SENSOR RUSAK / MATI...");
    const res4 = await sendPost({
      suhu_udara: 0,
      kelembapan_udara: 0,
      suhu_air: 0,
      kelembapan_tanah: 0,
      tds_nutrisi: 0,
      intensitas_cahaya: 0,
      baterai: 80,
      sensor_status: false // Sensor Rusak/Mati
    });
    console.log(`-> Response Server: Status ${res4.statusCode}`);
    console.log("-> Periksa dasbor web (Sensor: Rusak / Mati) & WhatsApp Anda!");
    if (arg === 'all') await sleep(3500);
  }

  // TEST 5: Simulasi Node ESP32 Mati / Offline (device_offline: true)
  if (arg === 'all' || arg === 'offline' || arg === 'alat') {
    console.log("\n[5] Mengirim Data Simulasi NODE ESP32 MATI / OFFLINE...");
    const res5 = await sendPost({
      suhu_udara: 27.0,
      kelembapan_udara: 70.0,
      suhu_air: 25.0,
      kelembapan_tanah: 65.0,
      tds_nutrisi: 600,
      intensitas_cahaya: 10000,
      baterai: 80,
      sensor_status: true,
      device_offline: true // Alat Mati/Offline
    });
    console.log(`-> Response Server: Status ${res5.statusCode}`);
    console.log("-> Periksa dasbor web (Alat: OFFLINE) & WhatsApp Anda!");
  }

  console.log("\n=================================================");
  console.log("✅ Uji coba selesai! Silakan periksa Dasbor & WhatsApp.");
  console.log("Tip: Anda juga bisa menguji satu per satu dengan:");
  console.log("  node test_alerts.js baterai");
  console.log("  node test_alerts.js kering");
  console.log("  node test_alerts.js kuota");
  console.log("  node test_alerts.js sensor");
  console.log("  node test_alerts.js offline");
  console.log("=================================================\n");
}

runTests().catch(console.error);
