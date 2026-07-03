const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = "DigitalTwinJWTSecret2026!";

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
// Node.js akan menyajikan index.html, style.css, dan model 3D dari folder frontend secara otomatis.
// Ini memudahkan deploy karena web app & API server berjalan di satu PORT yang sama (3000)
app.use(express.static(path.join(__dirname, '../frontend')));

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

  // Buat tabel users untuk login pengguna jika belum ada
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      planting_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrasi database: Tambahkan planting_date jika server dijalankan dari versi sebelumnya
  try {
    await db.exec("ALTER TABLE users ADD COLUMN planting_date TEXT");
  } catch (e) {
    // Kolom sudah ada, abaikan
  }

  console.log("[DATABASE] SQLite siap di ~/backend/database.db");
})();

const SECRET_KEY = "TwinSecr3tK3y_2026";

// --- ENDPOINT AUTENTIKASI ---
// Endpoint Registrasi Pengguna
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username dan password dibutuhkan." });
  
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    await db.run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hash]);
    res.status(201).json({ message: "Registrasi berhasil, silakan login." });
  } catch (err) {
    if (err.message.includes("UNIQUE constraint failed")) {
      return res.status(400).json({ error: "Username sudah digunakan, silakan pilih yang lain." });
    }
    res.status(500).json({ error: err.message });
  }
});

// Endpoint Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) return res.status(401).json({ error: "Username tidak ditemukan." });

    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) return res.status(401).json({ error: "Kata sandi salah." });

    // Cetak Token JWT berlaku 24 Jam
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.status(200).json({ message: "Login berhasil", token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MIDDLEWARE & ENDPOINT PENGATURAN PENGGUNA ---
const authRest = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized: No Token Provided" });
  const token = authHeader.split(' ')[1];
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: "Unauthorized: Invalid token" });
    req.user = decoded;
    next();
  });
};

// Ambil Pengaturan (Tanggal Tanam)
app.get('/api/user/settings', authRest, async (req, res) => {
  try {
    const user = await db.get("SELECT planting_date FROM users WHERE id = ?", [req.user.id]);
    res.status(200).json(user || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simpan Pengaturan (Tanggal Tanam)
app.put('/api/user/settings', authRest, async (req, res) => {
  const { planting_date } = req.body;
  try {
    await db.run("UPDATE users SET planting_date = ? WHERE id = ?", [planting_date, req.user.id]);
    res.status(200).json({ message: "Settings updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MIDDLEWARE WEBSOCKET AUTENTIKASI ---
// Mencegah klien anonim tanpa JWT Token untuk mendengarkan broadcast sensor
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error("Authentication error: Invalid token"));
    socket.user = decoded; // simpan data user ke dalam socket
    next();
  });
});

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
