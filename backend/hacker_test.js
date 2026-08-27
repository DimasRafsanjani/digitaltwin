const http = require('http');
const crypto = require('crypto');

const SECRET_KEY = "TwinSecr3tK3y_2026";
const HOST = "localhost";
const PORT = 3000;

console.log("=== SIMULASI SERANGAN SIBER (HACKER TEST) ===");

// Fungsi bantuan untuk mengirim request HTTP POST
function sendAttackRequest(testName, payload, timestamp, signatureToUse) {
  const body = JSON.stringify(payload);
  const options = {
    hostname: HOST,
    port: PORT,
    path: '/api/sensor',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Signature': signatureToUse,
      'X-Timestamp': timestamp
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`\n[${testName}]`);
      console.log(`Status HTTP: ${res.statusCode}`);
      console.log(`Respons Server: ${data.trim()}`);
      console.log("-----------------------------------------");
    });
  });

  req.on('error', (e) => {
    console.error(`[ERROR] Gagal mengirim data: ${e.message}`);
  });

  req.write(body);
  req.end();
}


// =========================================================================
// SKENARIO 1: MAN-IN-THE-MIDDLE ATTACK (MENGUBAH DATA DI TENGAH JALAN)
// =========================================================================
setTimeout(() => {
  const validTimestamp = Math.floor(Date.now() / 1000); // Waktu valid (sekarang)
  
  // 1. Data Asli yang dibuat alat (Suhu Normal 25.0)
  const payloadAsli = {
    suhu_udara: 25.0, kelembapan_udara: 60.0, suhu_air: 25.0, 
    kelembapan_tanah: 80, tds_nutrisi: 600, intensitas_cahaya: 10000, 
    baterai: 80, sensor_status: true
  };
  
  // 2. Buat Tanda Tangan (Signature) yang VALID untuk Data Asli
  const messageAsli = `${validTimestamp}:${payloadAsli.suhu_udara.toFixed(1)}:${payloadAsli.kelembapan_udara.toFixed(1)}:${payloadAsli.suhu_air.toFixed(1)}:${payloadAsli.kelembapan_tanah}:${payloadAsli.tds_nutrisi}:${payloadAsli.intensitas_cahaya.toFixed(1)}:${payloadAsli.baterai}:1`;
  const validSignature = crypto.createHmac('sha256', SECRET_KEY).update(messageAsli).digest('hex');

  // 3. HACKER MENGUBAH DATA! Suhu diganti jadi 99.0
  const payloadHacker = { ...payloadAsli };
  payloadHacker.suhu_udara = 99.0; 

  // Hacker mengirim Data Palsu (Suhu 99) tetapi menggunakan Tanda Tangan dari Data Asli
  sendAttackRequest("TEST 1: DATA DIPALSUKAN (Suhu -> 99°C)", payloadHacker, validTimestamp, validSignature);

}, 1000);


// =========================================================================
// SKENARIO 2: ANTI-REPLAY ATTACK (MENGIRIM ULANG DATA LAMA)
// =========================================================================
setTimeout(() => {
  // 1. Hacker punya paket data yang valid 100% dan signature yang benar, 
  // TETAPI paket ini disadap/dicuri 5 menit yang lalu (300 detik yang lalu).
  const expiredTimestamp = Math.floor(Date.now() / 1000) - 300; 

  const payloadLama = {
    suhu_udara: 30.0, kelembapan_udara: 50.0, suhu_air: 28.0, 
    kelembapan_tanah: 40, tds_nutrisi: 400, intensitas_cahaya: 15000, 
    baterai: 75, sensor_status: true
  };
  
  // Buat Signature valid untuk data tersebut (semuanya sah secara kriptografi)
  const messageLama = `${expiredTimestamp}:${payloadLama.suhu_udara.toFixed(1)}:${payloadLama.kelembapan_udara.toFixed(1)}:${payloadLama.suhu_air.toFixed(1)}:${payloadLama.kelembapan_tanah}:${payloadLama.tds_nutrisi}:${payloadLama.intensitas_cahaya.toFixed(1)}:${payloadLama.baterai}:1`;
  const validSignature = crypto.createHmac('sha256', SECRET_KEY).update(messageLama).digest('hex');

  // Hacker mencoba mengirim ulang data curian tersebut ke server
  sendAttackRequest("TEST 2: REPLAY ATTACK (Data 5 menit lalu)", payloadLama, expiredTimestamp, validSignature);

}, 2000);
