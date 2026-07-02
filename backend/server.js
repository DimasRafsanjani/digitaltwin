const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Inisiasi WebSocket Server dengan izin CORS
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3000;

app.use(express.json()); // Middleware untuk parse request JSON

// --- SERVING STATIC FILES (Frontend Web App) ---
// Node.js akan menyajikan index.html, style.css, dan model 3D dari folder utama secara otomatis.
// Ini memudahkan deploy karena web app & API server berjalan di satu PORT yang sama (3000)
app.use(express.static(path.join(__dirname, '../')));

// Database SQLite
let db;
(async () => {
  db = await open({
    filename: path.join(__dirname, 'database.db'),
    driver: sqlite3.Database
  });
  
  // Buat tabel log sensor jika belum ada
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sensor_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suhu_udara REAL,
      kelembapan_udara REAL,
      suhu_air REAL,
      kelembapan_tanah INTEGER,
      tds_nutrisi INTEGER,
      intensitas_cahaya REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("[DATABASE] SQLite siap di ~/backend/database.db");
})();

const SECRET_KEY = "TwinSecr3tK3y_2026";

// Endpoint API untuk ESP32 mengirim data (HTTP POST)
app.post('/api/sensor', async (req, res) => {
  const signature = req.headers['x-signature'];
  const timestamp = req.headers['x-timestamp'];
  const { suhu_udara, kelembapan_udara, suhu_air, kelembapan_tanah, tds_nutrisi, intensitas_cahaya } = req.body;

  // 1. Validasi keberadaan header keamanan
  if (!signature || !timestamp) {
    console.log("[SECURITY] Percobaan akses ditolak: Missing Signature or Timestamp!");
    return res.status(401).json({ status: "error", message: "Unauthorized: Missing Signature or Timestamp" });
  }

  // 2. Validasi Selisih Waktu (Anti-Replay Attack)
  // Menolak data yang dikirim lebih dari 60 detik yang lalu
  const serverTime = Math.floor(Date.now() / 1000);
  const timeDifference = Math.abs(serverTime - Number(timestamp));
  if (timeDifference > 60) {
    console.log(`[SECURITY] Percobaan akses ditolak: Timestamp expired! Selisih: ${timeDifference} detik.`);
    return res.status(401).json({ status: "error", message: "Unauthorized: Timestamp expired/invalid. Please sync time." });
  }

  // 3. Rekonstruksi Pesan untuk verifikasi tanda tangan
  // Format pesan disepakati: timestamp:suhu_udara:kelembapan_udara:suhu_air:kelembapan_tanah:tds_nutrisi:intensitas_cahaya
  const messageToSign = `${timestamp}:${Number(suhu_udara).toFixed(1)}:${Number(kelembapan_udara).toFixed(1)}:${Number(suhu_air).toFixed(1)}:${parseInt(kelembapan_tanah)}:${parseInt(tds_nutrisi)}:${Number(intensitas_cahaya).toFixed(1)}`;

  // 4. Hitung HMAC-SHA256
  const computedSignature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(messageToSign)
    .digest('hex');

  // 5. Cocokkan tanda tangan
  if (computedSignature !== signature) {
    console.log("[SECURITY] Percobaan akses ditolak: Invalid Digital Signature!");
    console.log("Pesan yang ditandatangani:", messageToSign);
    console.log("Signature dari klien:   ", signature);
    console.log("Signature dari server:  ", computedSignature);
    return res.status(401).json({ status: "error", message: "Unauthorized: Invalid Digital Signature" });
  }

  console.log("\n[API] Menerima data sensor baru (Authorized via HMAC-SHA256):", req.body);

  try {
    // 1. Simpan ke database
    await db.run(
      `INSERT INTO sensor_logs (suhu_udara, kelembapan_udara, suhu_air, kelembapan_tanah, tds_nutrisi, intensitas_cahaya) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [suhu_udara, kelembapan_udara, suhu_air, kelembapan_tanah, tds_nutrisi, intensitas_cahaya]
    );

    // 2. Broadcast ke semua browser terhubung via WebSockets
    io.emit('sensorUpdate', {
      suhu_udara,
      kelembapan_udara,
      suhu_air,
      kelembapan_tanah,
      tds_nutrisi,
      intensitas_cahaya,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({ status: "success", message: "Data received and broadcasted" });
  } catch (err) {
    console.error("Database error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Endpoint untuk melihat log data terakhir di browser
app.get('/api/sensor/latest', async (req, res) => {
  try {
    const row = await db.get("SELECT * FROM sensor_logs ORDER BY id DESC LIMIT 1");
    res.status(200).json(row || { message: "Belum ada log data sensor." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Jalankan server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`Server Backend Digital Twin berjalan di Port ${PORT}`);
  console.log(`Akses Web Dashboard di: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
