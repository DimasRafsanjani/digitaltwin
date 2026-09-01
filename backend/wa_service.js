const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

let sock = null;
let isConnected = false;
let qrCodeString = "";

// Folder penyimpanan sesi login WhatsApp (agar tidak perlu scan QR berulang kali)
const AUTH_DIR = path.join(__dirname, 'wa_auth');
const CONFIG_FILE = path.join(__dirname, 'wa_config.json');

// Pengaturan Cooldown Alert (mencegah spam pesan ke nomor WA setiap 10 detik)
const lastAlertTime = {
  battery_low: 0,
  drought: 0,
  sensor_error: 0,
  quota_low: 0,
  device_offline: 0
};
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 menit jeda per jenis peringatan

// Ambil atau Simpan Nomor WA Tujuan
function getTargetPhone() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.targetPhone) return cfg.targetPhone;
    }
  } catch (e) {}
  return ""; // Kosongkan jika belum diatur
}

function setTargetPhone(phone) {
  try {
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.slice(1);
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ targetPhone: cleanPhone }), 'utf8');
    console.log(`[WA] Nomor tujuan berhasil disimpan: ${cleanPhone}`);
    return cleanPhone;
  } catch (e) {
    console.error("[WA] Gagal menyimpan nomor tujuan:", e.message);
    return null;
  }
}

// Inisialisasi WhatsApp Client Baileys
async function initWhatsApp() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }), // Sembunyikan debug log berlebih
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeString = qr;
      console.log("\n=======================================================");
      console.log("[WHATSAPP GATEWAY] SILAKAN SCAN QR CODE DI BAWAH INI:");
      console.log("=======================================================");
      qrcode.generate(qr, { small: true });
      console.log("Buka WhatsApp di HP Anda > Perangkat Tertaut > Tautkan Perangkat.");
      console.log("=======================================================\n");
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      
      console.log(`[WA] Koneksi WhatsApp terputus. StatusCode: ${statusCode}, LoggedOut: ${isLoggedOut}`);
      
      if (isLoggedOut) {
        console.log("[WA] Sesi telah keluar / kedaluwarsa. Menghapus auth lama & membuat QR baru...");
        resetWhatsApp();
      } else {
        // Coba koneksi ulang
        setTimeout(initWhatsApp, 5000);
      }
    } else if (connection === 'open') {
      isConnected = true;
      qrCodeString = "";
      console.log("\n[WHATSAPP GATEWAY] Berhasil terhubung ke WhatsApp!\n");
    }
  });
}

// Fungsi Reset Sesi Login WhatsApp (Hapus cache agar QR muncul kembali)
async function resetWhatsApp() {
  try {
    isConnected = false;
    qrCodeString = "";
    if (sock) {
      try { sock.end(); } catch (e) {}
      sock = null;
    }
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      console.log("[WA] Cache sesi wa_auth berhasil dibersihkan.");
    }
    setTimeout(initWhatsApp, 1500);
    return true;
  } catch (err) {
    console.error("[WA RESET ERROR]:", err.message);
    return false;
  }
}

// Format Nomor Telepon ke JID WhatsApp
function formatToJid(phone) {
  let clean = phone.replace(/[^0-9]/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.slice(1);
  }
  if (!clean.endsWith('@s.whatsapp.net')) {
    clean = clean + '@s.whatsapp.net';
  }
  return clean;
}

// Fungsi Mengirim Pesan WhatsApp
async function sendWhatsAppMessage(targetNumber, message) {
  if (!sock || !isConnected) {
    console.log("[WA ALERT] Gagal kirim: WhatsApp Gateway belum terhubung/login.");
    return false;
  }

  try {
    const jid = formatToJid(targetNumber);
    await sock.sendMessage(jid, { text: message });
    console.log(`[WA ALERT] Berhasil mengirim notifikasi ke: ${jid}`);
    return true;
  } catch (err) {
    console.error("[WA ALERT ERROR]:", err.message);
    return false;
  }
}

// Evaluasi Data Sensor & Kirim Alert Otomatis jika Kritis
async function checkAndSendSensorAlerts(payload) {
  const targetPhone = getTargetPhone();
  if (!targetPhone) {
    // Belum ada nomor tujuan yang diatur
    return;
  }

  const now = Date.now();
  const dateStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  // 1. Alert Daya Baterai Rendah (< 20%)
  if (payload.baterai !== undefined && Number(payload.baterai) < 20) {
    if (now - lastAlertTime.battery_low > ALERT_COOLDOWN_MS) {
      lastAlertTime.battery_low = now;
      const msg = `⚠️ *[PERINGATAN DIGITAL TWIN SAWAH]*\n\n` +
                  `🔋 *Daya Baterai Node Sawah Kritis!*\n` +
                  `• Sisa Baterai: *${payload.baterai}%*\n` +
                  `• Waktu: ${dateStr} WIB\n` +
                  `• Status: Segera lakukan pengisian daya atau penggantian baterai agar pemantauan tidak terputus.\n\n` +
                  `🌐 Dasbor: http://localhost:3000`;
      await sendWhatsAppMessage(targetPhone, msg);
    }
  }

  // 2. Alert Stres Kekeringan Air Sawah (< 45%)
  if (payload.kelembapan_tanah !== undefined && Number(payload.kelembapan_tanah) < 45) {
    if (now - lastAlertTime.drought > ALERT_COOLDOWN_MS) {
      lastAlertTime.drought = now;
      const msg = `⚠️ *[PERINGATAN DIGITAL TWIN SAWAH]*\n\n` +
                  `🌾 *Kondisi Tanah Mengalami Kekeringan!*\n` +
                  `• Kelembapan Tanah: *${payload.kelembapan_tanah}%* (Ambang Kritis < 45%)\n` +
                  `• Suhu Udara: ${payload.suhu_udara || '-'} °C\n` +
                  `• Waktu: ${dateStr} WIB\n` +
                  `• Rekomendasi: Tanaman padi mulai mengalami kelayuan turgor. Segera aktifkan pompa irigasi petak sawah!\n\n` +
                  `🌐 Dasbor: http://localhost:3000`;
      await sendWhatsAppMessage(targetPhone, msg);
    }
  }

  // 3. Alert Kerusakan / Anomali Sensor Fisik
  if (payload.sensor_status === false || payload.sensor_status === 0 || payload.sensor_status === "0") {
    if (now - lastAlertTime.sensor_error > ALERT_COOLDOWN_MS) {
      lastAlertTime.sensor_error = now;
      const msg = `🚨 *[PERINGATAN DIGITAL TWIN SAWAH]*\n\n` +
                  `🛠️ *Sensor Hardware Rusak / Mati!*\n` +
                  `• Status Sensor: *RUSAK / MATI (Gagal Baca)*\n` +
                  `• Waktu: ${dateStr} WIB\n` +
                  `• Tindakan: Periksa kabel jumper dan probe sensor di kotak IoT lapangan.\n\n` +
                  `🌐 Dasbor: http://localhost:3000`;
      await sendWhatsAppMessage(targetPhone, msg);
    }
  }

  // 4. Alert Sisa Kuota SIM Card Menipis (< 10% / < 500 MB atau simulasi)
  if (payload.sisa_kuota_mb !== undefined && Number(payload.sisa_kuota_mb) < 500) {
    if (now - lastAlertTime.quota_low > ALERT_COOLDOWN_MS) {
      lastAlertTime.quota_low = now;
      const msg = `⚠️ *[PERINGATAN DIGITAL TWIN SAWAH]*\n\n` +
                  `📶 *Sisa Kuota SIM Card IoT Menipis!*\n` +
                  `• Sisa Kuota: *${payload.sisa_kuota_mb} MB* (< 10% dari kuota 5 GB)\n` +
                  `• Waktu: ${dateStr} WIB\n` +
                  `• Tindakan: Segera lakukan isi ulang paket data SIM Card agar transmisi telemetri ESP32 tidak terputus.\n\n` +
                  `🌐 Dasbor: http://localhost:3000`;
      await sendWhatsAppMessage(targetPhone, msg);
    }
  }

  // 5. Alert Node ESP32 Mati / Offline (> 15 Menit Tidak Ada Transmisi)
  if (payload.device_offline === true || payload.status === "offline") {
    if (now - lastAlertTime.device_offline > ALERT_COOLDOWN_MS) {
      lastAlertTime.device_offline = now;
      const msg = `🚨 *[PERINGATAN DIGITAL TWIN SAWAH]*\n\n` +
                  `🔌 *Node ESP32 Mati / Terputus (OFFLINE)!*\n` +
                  `• Status: Tidak ada transmisi data melebihi siklus Deep Sleep wajar (> 15 menit).\n` +
                  `• Dugaan: Baterai habis total, modul GPRS putus koneksi, atau perangkat mati.\n` +
                  `• Waktu: ${dateStr} WIB\n` +
                  `• Tindakan: Periksa kondisi catu daya baterai dan perangkat IoT di lahan sawah.\n\n` +
                  `🌐 Dasbor: http://localhost:3000`;
      await sendWhatsAppMessage(targetPhone, msg);
    }
  }
}

module.exports = {
  initWhatsApp,
  resetWhatsApp,
  sendWhatsAppMessage,
  checkAndSendSensorAlerts,
  getTargetPhone,
  setTargetPhone,
  getStatus: () => ({ isConnected, qrCodeString })
};
