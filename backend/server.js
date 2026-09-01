const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { initWhatsApp, resetWhatsApp, checkAndSendSensorAlerts, getTargetPhone, setTargetPhone, getStatus, sendWhatsAppMessage } = require('./wa_service');

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

app.use(express.json({ limit: '50mb' })); // Middleware untuk parse request JSON (limit 50mb untuk database restore)
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
      baterai INTEGER,
      sensor_status BOOLEAN,
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
  
  // Migrasi database untuk baterai & status
  try { await db.exec("ALTER TABLE sensor_logs ADD COLUMN baterai INTEGER"); } catch(e){}
  try { await db.exec("ALTER TABLE sensor_logs ADD COLUMN sensor_status BOOLEAN"); } catch(e){}

  console.log("[DATABASE] SQLite siap di ~/backend/database.db");
})();

const SECRET_KEY = "TwinSecr3tK3y_2026";

// --- FUNGSI CLASS DIAGRAM ---
async function VerifikasiAkun(username, password, isRegister, res) {
  if (isRegister) {
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
  } else {
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
  }
}

// Endpoint Registrasi Pengguna
app.post('/api/register', async (req, res) => {
  await VerifikasiAkun(req.body.username, req.body.password, true, res);
});

// Endpoint Login
app.post('/api/login', async (req, res) => {
  await VerifikasiAkun(req.body.username, req.body.password, false, res);
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

// --- HANDLE WEBSOCKET CONNECTION EVENT ---
// Mengirim data sensor terakhir dari database begitu klien terhubung
io.on('connection', async (socket) => {
  console.log(`[WS] Klien terhubung: ${socket.user?.username || 'Guest'} (ID: ${socket.id})`);
  try {
    const row = await db.get("SELECT * FROM sensor_logs ORDER BY id DESC LIMIT 1");
    if (row) {
      // Kirim data terakhir agar tampilan dasbor web klien langsung terisi (tidak menunggu 10 menit)
      socket.emit('sensorUpdate', row);
    }
  } catch (err) {
    console.error("[WS] Gagal mengirim data awal ke klien:", err.message);
  }
});

// --- FUNGSI CLASS DIAGRAM SENSOR ---
async function SimpanLog(data) {
  const { suhu_udara, kelembapan_udara, suhu_air, kelembapan_tanah, tds_nutrisi, intensitas_cahaya, baterai, sensor_status } = data;
  await db.run(
    `INSERT INTO sensor_logs (suhu_udara, kelembapan_udara, suhu_air, kelembapan_tanah, tds_nutrisi, intensitas_cahaya, baterai, sensor_status) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [suhu_udara, kelembapan_udara, suhu_air, kelembapan_tanah, tds_nutrisi, intensitas_cahaya, baterai, sensor_status]
  );
}

function BroadcastData(data) {
  const { suhu_udara, kelembapan_udara, suhu_air, kelembapan_tanah, tds_nutrisi, intensitas_cahaya, baterai, sensor_status } = data;
  io.emit('sensorUpdate', {
    suhu_udara,
    kelembapan_udara,
    suhu_air,
    kelembapan_tanah,
    tds_nutrisi,
    intensitas_cahaya,
    baterai,
    sensor_status,
    esp_status: true,
    timestamp: new Date().toISOString()
  });
}

async function TerimaDataSensor(req, res) {
  const signature = req.headers['x-signature'];
  const timestamp = req.headers['x-timestamp'];
  const { suhu_udara, kelembapan_udara, suhu_air, kelembapan_tanah, tds_nutrisi, intensitas_cahaya, baterai, sensor_status } = req.body;

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
  const messageToSign = `${timestamp}:${Number(suhu_udara).toFixed(1)}:${Number(kelembapan_udara).toFixed(1)}:${Number(suhu_air).toFixed(1)}:${parseInt(kelembapan_tanah)}:${parseInt(tds_nutrisi)}:${Number(intensitas_cahaya).toFixed(1)}:${parseInt(baterai)}:${sensor_status === true || sensor_status === "true" ? "1" : "0"}`;

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
    await SimpanLog(req.body);
    BroadcastData(req.body);
    // Evaluasi dan kirim alert WhatsApp jika ada kondisi kritis (baterai low, kekeringan, error sensor)
    checkAndSendSensorAlerts(req.body).catch(e => console.error("[WA ERROR]:", e.message));
    res.status(200).json({ status: "success", message: "Data received and broadcasted" });
  } catch (err) {
    console.error("Database error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
}

// Endpoint API untuk ESP32 mengirim data (HTTP POST)
app.post('/api/sensor', TerimaDataSensor);

// Endpoint untuk melihat log data terakhir di browser
app.get('/api/sensor/latest', async (req, res) => {
  try {
    const row = await db.get("SELECT * FROM sensor_logs ORDER BY id DESC LIMIT 1");
    res.status(200).json(row || { message: "Belum ada log data sensor." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DISASTER RECOVERY & BACKUP ENDPOINTS (Revisi Sidang) ---

// 1. Export / Backup Database (JSON Snapshot)
app.get('/api/admin/backup', async (req, res) => {
  try {
    const logs = await db.all("SELECT * FROM sensor_logs ORDER BY id ASC");
    const users = await db.all("SELECT id, username, password_hash, planting_date, created_at FROM users");
    
    const backupData = {
      version: "1.0",
      system: "Rice Plant Digital Twin (Digital Shadow 3D)",
      backup_timestamp: new Date().toISOString(),
      record_count: {
        sensor_logs: logs.length,
        users: users.length
      },
      data: {
        users: users,
        sensor_logs: logs
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=backup_rice_twin_${Date.now()}.json`);
    res.status(200).json(backupData);
  } catch (err) {
    console.error("[BACKUP ERROR]:", err.message);
    res.status(500).json({ error: "Gagal membuat backup database: " + err.message });
  }
});

// 2. Import / Restore Database
app.post('/api/admin/restore', async (req, res) => {
  try {
    const backup = req.body;
    if (!backup || !backup.data) {
      return res.status(400).json({ error: "Format file backup tidak valid." });
    }

    const { users, sensor_logs } = backup.data;

    // Gunakan Transaction untuk integritas data
    await db.exec("BEGIN TRANSACTION");

    try {
      if (sensor_logs && Array.isArray(sensor_logs)) {
        await db.exec("DELETE FROM sensor_logs");
        const stmtSensor = await db.prepare(`
          INSERT INTO sensor_logs (id, suhu_udara, kelembapan_udara, suhu_air, kelembapan_tanah, tds_nutrisi, intensitas_cahaya, baterai, sensor_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const log of sensor_logs) {
          await stmtSensor.run(
            log.id || null,
            log.suhu_udara,
            log.kelembapan_udara,
            log.suhu_air,
            log.kelembapan_tanah,
            log.tds_nutrisi,
            log.intensitas_cahaya,
            log.baterai || 100,
            log.sensor_status !== undefined ? (log.sensor_status ? 1 : 0) : 1,
            log.created_at || new Date().toISOString()
          );
        }
        await stmtSensor.finalize();
      }

      if (users && Array.isArray(users) && users.length > 0) {
        for (const u of users) {
          await db.run(
            `INSERT OR REPLACE INTO users (id, username, password_hash, planting_date, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [u.id, u.username, u.password_hash, u.planting_date, u.created_at || new Date().toISOString()]
          );
        }
      }

      await db.exec("COMMIT");
      console.log(`[RESTORE] Database berhasil dipulihkan: ${sensor_logs?.length || 0} sensor logs, ${users?.length || 0} users.`);
      res.status(200).json({ 
        message: "Database berhasil dipulihkan sepenuhnya!", 
        restored_logs: sensor_logs?.length || 0,
        restored_users: users?.length || 0
      });
    } catch (restoreErr) {
      await db.exec("ROLLBACK");
      throw restoreErr;
    }
  } catch (err) {
    console.error("[RESTORE ERROR]:", err.message);
    res.status(500).json({ error: "Gagal memulihkan database: " + err.message });
  }
});

// 3. Telemetry Stats & Data Usage Estimation (Analisis Kuota)
app.get('/api/admin/data-usage', async (req, res) => {
  try {
    const countResult = await db.get("SELECT COUNT(*) as total_transmissions FROM sensor_logs");
    const todayResult = await db.get("SELECT COUNT(*) as today_transmissions FROM sensor_logs WHERE date(created_at) = date('now')");
    
    const totalTransmissions = countResult?.total_transmissions || 0;
    const todayTransmissions = todayResult?.today_transmissions || 0;
    
    // Rata-rata ukuran payload JSON ESP32 = 250 byte
    // Overhead HTTP + TCP/IP header = ~350 byte
    // Total per transmisi = ~600 byte
    const payloadBytePerPacket = 250;
    const totalBytePerPacket = 600;

    const totalUsageBytes = totalTransmissions * totalBytePerPacket;
    const todayUsageBytes = todayTransmissions * totalBytePerPacket;

    res.status(200).json({
      total_transmissions: totalTransmissions,
      today_transmissions: todayTransmissions,
      payload_size_bytes: payloadBytePerPacket,
      total_packet_size_bytes: totalBytePerPacket,
      total_usage_kb: (totalUsageBytes / 1024).toFixed(2),
      today_usage_kb: (todayUsageBytes / 1024).toFixed(2),
      estimated_monthly_mb: ((144 * 30 * totalBytePerPacket) / (1024 * 1024)).toFixed(2) // 144 transmisi/hari
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. WhatsApp Gateway Status & Config Endpoints
app.get('/api/admin/wa/status', (req, res) => {
  const status = getStatus();
  res.status(200).json({
    connected: status.isConnected,
    targetPhone: getTargetPhone(),
    qrAvailable: !!status.qrCodeString
  });
});

app.post('/api/admin/wa/config', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Nomor telepon harus diisi." });
  const saved = setTargetPhone(phone);
  if (saved) {
    res.status(200).json({ message: "Nomor WhatsApp tujuan berhasil disimpan!", targetPhone: saved });
  } else {
    res.status(500).json({ error: "Gagal menyimpan nomor WhatsApp." });
  }
});

app.post('/api/admin/wa/test', async (req, res) => {
  const target = getTargetPhone();
  if (!target) return res.status(400).json({ error: "Nomor WhatsApp tujuan belum diatur. Silakan atur nomor terlebih dahulu." });
  
  const testMsg = `🌾 *[DIGITAL TWIN SAWAH - TES NOTIFIKASI]*\n\n` +
                  `Halo! Pesan ini adalah uji coba sistem notifikasi otomatis Digital Twin Tanaman Padi.\n` +
                  `Waktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
                  `Status: *Koneksi WhatsApp Gateway Berhasil Terhubung!* ✅`;
  
  const sent = await sendWhatsAppMessage(target, testMsg);
  if (sent) {
    res.status(200).json({ message: `Pesan uji coba berhasil dikirim ke nomor ${target}!` });
  } else {
    res.status(500).json({ error: "Gagal mengirim pesan WhatsApp. Pastikan WhatsApp Gateway sudah login (scan QR)." });
  }
});

app.post('/api/admin/wa/reset', async (req, res) => {
  console.log("[WA] Permintaan reset sesi WhatsApp diterima dari admin...");
  const reset = await resetWhatsApp();
  if (reset) {
    res.status(200).json({ message: "Sesi WhatsApp berhasil di-reset. Silakan periksa terminal untuk scan QR baru." });
  } else {
    res.status(500).json({ error: "Gagal me-reset sesi WhatsApp." });
  }
});

// Jalankan server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`Server Backend Digital Twin berjalan di Port ${PORT}`);
  console.log(`Akses Web Dashboard di: http://localhost:${PORT}`);
  console.log(`======================================================\n`);

  // Inisialisasi WhatsApp Gateway (Baileys)
  initWhatsApp().catch(err => {
    console.error("[WA INIT ERROR]:", err.message);
  });
});
