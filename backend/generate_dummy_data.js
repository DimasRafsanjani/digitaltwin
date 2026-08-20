/**
 * generate_dummy_data.js
 * =============================================
 * Menghasilkan data sensor dummy yang realistis ke database SQLite.
 * Data dibuat mundur 2 minggu dari tanggal 20 Juli 2026,
 * dengan interval pembacaan setiap 10 menit.
 *
 * Pola data mengikuti siklus harian alami:
 *   - Suhu udara: naik siang, turun malam
 *   - Kelembapan udara: kebalikan suhu
 *   - Suhu air: lebih stabil dari udara, sedikit naik siang
 *   - Kelembapan tanah: perlahan turun, naik saat "disiram"
 *   - TDS nutrisi: relatif stabil, naik setelah "pemupukan"
 *   - Intensitas cahaya: mengikuti kurva matahari (0 malam, puncak siang)
 *
 * Usage:
 *   cd backend
 *   node generate_dummy_data.js
 *
 * PERINGATAN: Script ini akan MENAMBAHKAN data ke tabel sensor_logs.
 *   Jika ingin data bersih, hapus database.sqlite terlebih dahulu.
 */

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

// ── Konfigurasi ──────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'database.sqlite');
const INTERVAL_MINUTES = 10;

// Mundur 14 hari dari 20 Juli 2026 pukul 23:50 WIB
const END_DATE   = new Date('2026-07-20T23:50:00+07:00');
const START_DATE = new Date('2026-07-06T00:00:00+07:00');

// ── Helper Functions ─────────────────────────────────────────

/**
 * Random float dalam range [min, max] dengan noise acak.
 */
function rand(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Clamp nilai agar tetap dalam batas.
 */
function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Menghitung faktor siklus matahari berdasarkan jam (0-23).
 * Mengembalikan 0.0 (malam) hingga 1.0 (puncak siang ~12:00).
 * Matahari terbit ~05:30, terbenam ~17:30 (untuk daerah tropis).
 */
function sunFactor(hour, minute) {
  const timeDecimal = hour + minute / 60;
  if (timeDecimal < 5.5 || timeDecimal > 17.5) return 0; // Malam
  // Kurva sinusoidal: puncak di jam 12:00
  const normalized = (timeDecimal - 5.5) / 12; // 0 to 1
  return Math.sin(normalized * Math.PI);
}

/**
 * Generate satu baris data sensor berdasarkan waktu dan state sebelumnya.
 */
function generateReading(date, prevState) {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const dayOfSim = Math.floor((date - START_DATE) / (1000 * 60 * 60 * 24));
  const sun = sunFactor(hour, minute);

  // ── Suhu Udara (°C) ──────────────────────────────────────
  // Pagi ~23°C, siang ~33°C, malam ~24°C (tropis dataran rendah)
  const suhuBase = 24 + sun * 9;
  const suhu_udara = clamp(suhuBase + rand(-1.5, 1.5), 21, 37);

  // ── Kelembapan Udara (%) ──────────────────────────────────
  // Kebalikan suhu: tinggi malam (~85%), rendah siang (~55%)
  const humidBase = 85 - sun * 30;
  const kelembapan_udara = clamp(humidBase + rand(-5, 5), 45, 98);

  // ── Suhu Air (°C) ────────────────────────────────────────
  // Lebih stabil dari udara, sedikit naik siang
  const suhuAirBase = 25 + sun * 4;
  const suhu_air = clamp(suhuAirBase + rand(-0.8, 0.8), 22, 33);

  // ── Kelembapan Tanah (%) ──────────────────────────────────
  // Simulasi: perlahan turun tiap hari, lalu "disiram" setiap 3 hari
  // Saat disiram, naik ke ~80-90%, lalu turun ~3-5% per hari
  const daysSinceWatering = dayOfSim % 3; // Siklus siram tiap 3 hari
  let soilBase;
  if (daysSinceWatering === 0 && hour >= 6 && hour <= 8) {
    // Pagi hari penyiraman
    soilBase = rand(78, 92);
  } else {
    // Perlahan turun
    soilBase = prevState.kelembapan_tanah - rand(0.01, 0.08);
    // Sedikit naik malam (embun)
    if (hour >= 0 && hour <= 5) soilBase += rand(0, 0.03);
    // Sedikit turun siang (evaporasi)
    if (sun > 0.5) soilBase -= rand(0, 0.05);
  }
  const kelembapan_tanah = Math.round(clamp(soilBase, 28, 95));

  // ── TDS Nutrisi (ppm) ────────────────────────────────────
  // Relatif stabil 300-600 ppm, naik setelah "pemupukan" tiap 5 hari
  let tdsBase = prevState.tds_nutrisi + rand(-3, 3);
  const daysSinceFertilize = dayOfSim % 5;
  if (daysSinceFertilize === 0 && hour === 7 && minute === 0) {
    tdsBase = rand(550, 700); // Setelah pupuk
  } else {
    // Perlahan turun karena diserap tanaman
    tdsBase -= rand(0.1, 0.5);
  }
  const tds_nutrisi = Math.round(clamp(tdsBase, 200, 800));

  // ── Intensitas Cahaya (Lux) ──────────────────────────────
  // 0 malam, puncak ~60.000-80.000 lux siang cerah
  let lightBase;
  if (sun <= 0) {
    lightBase = rand(0, 5); // Malam gelap
  } else {
    // Simulasi awan acak: kadang cerah, kadang mendung
    const cloudFactor = Math.random() > 0.3 ? 1.0 : rand(0.2, 0.6);
    lightBase = sun * 75000 * cloudFactor;
  }
  const intensitas_cahaya = clamp(lightBase + rand(-500, 500), 0, 100000);

  return {
    suhu_udara: Math.round(suhu_udara * 100) / 100,
    kelembapan_udara: Math.round(kelembapan_udara * 100) / 100,
    suhu_air: Math.round(suhu_air * 100) / 100,
    kelembapan_tanah,
    tds_nutrisi,
    intensitas_cahaya: Math.round(intensitas_cahaya * 100) / 100,
  };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('  Generator Data Dummy Sensor - Digital Twin Padi');
  console.log('='.repeat(60));
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Periode  : ${START_DATE.toLocaleDateString('id-ID')} - ${END_DATE.toLocaleDateString('id-ID')}`);
  console.log(`  Interval : ${INTERVAL_MINUTES} menit`);

  // Hitung total data points
  const totalMinutes = (END_DATE - START_DATE) / (1000 * 60);
  const totalPoints = Math.floor(totalMinutes / INTERVAL_MINUTES);
  console.log(`  Total    : ~${totalPoints} data points`);
  console.log('='.repeat(60));

  // Buka database
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  // Pastikan tabel ada
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

  // Cek data yang sudah ada
  const existing = await db.get('SELECT COUNT(*) as count FROM sensor_logs');
  if (existing.count > 0) {
    console.log(`\n  [!] Database sudah berisi ${existing.count} data.`);
    console.log('  [!] Data baru akan DITAMBAHKAN di atas data lama.');
    console.log('  [!] Untuk data bersih, hapus database.sqlite dulu.\n');
  }

  // State awal (kondisi "normal")
  let state = {
    kelembapan_tanah: 75,
    tds_nutrisi: 450,
  };

  // Prepare statement untuk insert cepat
  const stmt = await db.prepare(`
    INSERT INTO sensor_logs (suhu_udara, kelembapan_udara, suhu_air,
                             kelembapan_tanah, tds_nutrisi, intensitas_cahaya,
                             created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Begin transaction untuk kecepatan
  await db.exec('BEGIN TRANSACTION');

  let inserted = 0;
  let currentDate = new Date(START_DATE);

  while (currentDate <= END_DATE) {
    const reading = generateReading(currentDate, state);

    // Format datetime untuk SQLite (UTC/ISO format)
    const dateStr = currentDate.toISOString().replace('T', ' ').substring(0, 19);

    await stmt.run(
      reading.suhu_udara,
      reading.kelembapan_udara,
      reading.suhu_air,
      reading.kelembapan_tanah,
      reading.tds_nutrisi,
      reading.intensitas_cahaya,
      dateStr
    );

    // Update state untuk pembacaan berikutnya
    state.kelembapan_tanah = reading.kelembapan_tanah;
    state.tds_nutrisi = reading.tds_nutrisi;

    inserted++;

    // Progress log setiap 500 baris
    if (inserted % 500 === 0) {
      process.stdout.write(`\r  Inserting... ${inserted}/${totalPoints} (${Math.round(inserted/totalPoints*100)}%)`);
    }

    // Tambah interval
    currentDate = new Date(currentDate.getTime() + INTERVAL_MINUTES * 60 * 1000);
  }

  await db.exec('COMMIT');
  await stmt.finalize();

  // Statistik
  const stats = await db.get(`
    SELECT
      COUNT(*) as total,
      MIN(created_at) as first_entry,
      MAX(created_at) as last_entry,
      ROUND(AVG(suhu_udara), 1) as avg_suhu,
      ROUND(AVG(kelembapan_tanah), 1) as avg_soil,
      ROUND(AVG(tds_nutrisi), 1) as avg_tds,
      MIN(kelembapan_tanah) as min_soil,
      MAX(kelembapan_tanah) as max_soil,
      ROUND(AVG(intensitas_cahaya), 0) as avg_light
    FROM sensor_logs
  `);

  console.log(`\r  Inserting... SELESAI!                          `);
  console.log('\n' + '='.repeat(60));
  console.log('  HASIL:');
  console.log('='.repeat(60));
  console.log(`  Total records   : ${stats.total}`);
  console.log(`  Rentang waktu   : ${stats.first_entry} - ${stats.last_entry}`);
  console.log(`  Avg suhu udara  : ${stats.avg_suhu} C`);
  console.log(`  Avg kel. tanah  : ${stats.avg_soil}% (min: ${stats.min_soil}%, max: ${stats.max_soil}%)`);
  console.log(`  Avg TDS nutrisi : ${stats.avg_tds} ppm`);
  console.log(`  Avg cahaya      : ${stats.avg_light} lux`);
  console.log('='.repeat(60));

  // Tampilkan 5 sampel terakhir
  const samples = await db.all(`
    SELECT * FROM sensor_logs ORDER BY id DESC LIMIT 5
  `);
  console.log('\n  5 Data Terakhir:');
  console.log('  ' + '-'.repeat(56));
  for (const s of samples) {
    console.log(`  ${s.created_at} | Suhu:${s.suhu_udara}C Soil:${s.kelembapan_tanah}% TDS:${s.tds_nutrisi}ppm Light:${s.intensitas_cahaya}lx`);
  }

  await db.close();
  console.log('\n  [OK] Database ditutup. Selesai!\n');
}

main().catch(err => {
  console.error('  [ERROR]', err.message);
  process.exit(1);
});
