/**
 * 🔥 CHATBOT AI — KARHUTLA KALTIM
 * Google Apps Script — proxy ke Xiaomi MiMo AI API
 *
 * CARA PAKAI:
 * 1. Dapatkan API key gratis dari https://aistudio.google.com/apikey
 * 2. Ganti GEMINI_API_KEY di bawah
 * 3. File → New → Apps Script → paste kode ini → simpan
 * 4. Deploy → New deployment → Web app → Execute as "Me" → Anyone
 * 5. Copy URL web app-nya, paste ke index.html
 */

const GEMINI_API_KEY = 'sk-sonexe61jz7ai7eivon9ukfshvabkqct94fitikiw8xrstnc';
const DATA_URL = 'https://raw.githubusercontent.com/ojanzul/karhutla-kaltim-BMKG/main/data.json';
const MODEL = 'xiaomi/mimo-v2.5-pro';

// ==== THRESHOLD & KLASIFIKASI ====
const FWI_THRESHOLDS = [2, 7, 13];
const FFMC_THRESHOLDS = [76, 83, 89];
const KAB_ALIASES = {
  'samarinda': 'Kota Samarinda',
  'balikpapan': 'Kota Balikpapan',
  'bontang': 'Kota Bontang',
  'kukar': 'Kab. Kutai Kartanegara',
  'kutai kartanegara': 'Kab. Kutai Kartanegara',
  'kutim': 'Kab. Kutai Timur',
  'kutai timur': 'Kab. Kutai Timur',
  'kubar': 'Kab. Kutai Barat',
  'kutai barat': 'Kab. Kutai Barat',
  'ppu': 'Kab. Penajam Paser Utara',
  'penajam': 'Kab. Penajam Paser Utara',
  'penajam paser utara': 'Kab. Penajam Paser Utara',
  'paser': 'Kab. Paser',
  'berau': 'Kab. Berau',
  'mahulu': 'Kab. Mahakam Ulu',
  'mahakam ulu': 'Kab. Mahakam Ulu',
};
const DAY_LABELS = ['Hari ini', 'Besok', 'Lusa'];

// ============================================================
// HANDLER — endpoint POST
// ============================================================

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const query = (body.query || '').trim();
    const history = body.history || [];
    const tanggal = body.tanggal || '';

    // Ambil data.json terbaru dari GitHub
    let dataContext = '';
    try {
      const resp = UrlFetchApp.fetch(DATA_URL + '?t=' + Date.now(), { muteHttpExceptions: true, timeout: 15 });
      if (resp.getResponseCode() === 200) {
        dataContext = buildDataContext(JSON.parse(resp.getContentText()));
      } else {
        dataContext = '⚠️ Data tidak bisa dimuat (HTTP ' + resp.getResponseCode() + ').';
      }
    } catch (e) {
      dataContext = '⚠️ Data tidak bisa dimuat: ' + e.message;
    }

    // Bangun system prompt + riwayat + query → call Gemini
    const systemPrompt = buildSystemPrompt(dataContext, tanggal);
    const reply = callGemini(systemPrompt, history, query);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, response: reply }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'Chatbot AI Karhutla Kaltim aktif. Kirim POST dengan {query, history}.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// BANGUN KONTEKS DATA dari data.json
// ============================================================

function buildDataContext(data) {
  if (!data || !data.days || data.days.length === 0) return 'Data kosong.';

  let lines = [];
  lines.push('📅 Data diperbarui: ' + (data.generated_at || '—'));
  lines.push('');

  data.days.forEach(function (day) {
    var label = DAY_LABELS[day.offset] || ('H+' + day.offset);
    lines.push('── ' + label + ' (' + day.date + ') ──');
    lines.push('');

    if (!day.regions || day.regions.length === 0) {
      lines.push('(belum ada data)');
      return;
    }

    day.regions.forEach(function (r) {
      var fwiCls = classifyIdx(r.fwi, FWI_THRESHOLDS);
      var ffmcCls = classifyIdx(r.ffmc, FFMC_THRESHOLDS);
      var line = '• ' + r.name + ' — FWI: ' + val(r.fwi) + ' (' + fwiCls + '), FFMC: ' + val(r.ffmc) + ' (' + ffmcCls + ')';

      // Kecamatan
      if (r.kecamatan && r.kecamatan.length > 0) {
        var kecs = r.kecamatan.sort(function (a, b) { return (b.fwi || 0) - (a.fwi || 0); });
        var topKec = kecs.slice(0, 5).map(function (k) {
          var kwc = classifyIdx(k.fwi, FWI_THRESHOLDS);
          return k.name + ' (FWI ' + val(k.fwi) + ' ' + kwc + ')';
        }).join(', ');
        line += ' | Kecamatan terparah: ' + topKec;
        if (r.kecamatan.length > 5) line += ', dan ' + (r.kecamatan.length - 5) + ' lainnya';
      }

      lines.push(line);
    });

    lines.push('');
  });

  // Ringkasan
  var latest = data.days[0];
  if (latest && latest.regions) {
    var fwiVals = latest.regions.filter(function (r) { return r.fwi != null; }).map(function (r) { return r.fwi; });
    if (fwiVals.length > 0) {
      var avg = (fwiVals.reduce(function (a, b) { return a + b; }, 0) / fwiVals.length).toFixed(1);
      var top = latest.regions.filter(function (r) { return r.fwi != null; }).sort(function (a, b) { return b.fwi - a.fwi; })[0];
      lines.push('📊 Rata-rata FWI provinsi hari ini: ' + avg + ' — tertinggi: ' + top.name + ' (' + top.fwi + ')');
    }
  }

  return lines.join('\n');
}

function val(v) { return v != null ? v : '—'; }

function classifyIdx(v, thresholds) {
  if (v == null) return '❓';
  if (v >= thresholds[2]) return '🔴 EKSTRIM';
  if (v >= thresholds[1]) return '🟠 TINGGI';
  if (v >= thresholds[0]) return '🟡 SEDANG';
  return '🟢 RENDAH';
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt(dataContext, tanggal) {
  return [
    'Kamu adalah asisten AI untuk **Sistem Siaga Karhutla (Kebakaran Hutan & Lahan) — Kalimantan Timur**.',
    'Tugasmu menjawab pertanyaan user berdasarkan DATA NYATA di bawah ini.',
    '',
    '## ATURAN',
    '- Jawab dalam **Bahasa Indonesia** yang santai, singkat, padat.',
    '- Gunakan **emoji** untuk memperjelas status (🔥🟢🟡🟠🔴📈📉).',
    '- Jika user tanya data spesifik, sebut angka pastinya dari data.',
    '- Jika user tanya "kecamatannya" tanpa menyebut kabupaten, lihat riwayat chat sebelumnya.',
    '- Jika data tidak ada di konteks, bilang "Data untuk wilayah itu belum tersedia" — jangan mengarang.',
    '- Bisa memberi rekomendasi/saran tindakan berdasarkan level FWI & FFMC.',
    '- Jika user tanya tren, bandingkan data hari ini dengan besok/lusa (antar hari).',
    '- Untuk perbandingan antar wilayah, sebut mana yang lebih berisiko.',
    '- Tanggapan maksimal 3-4 kalimat, kecuali diminta detail.',
    '',
    '## KLASIFIKASI FWI (Fire Weather Index)',
    '🔴 EKSTRIM ≥ 13 — Api bisa sangat besar & sulit dikendalikan',
    '🟠 TINGGI 7–13 — Api berpotensi cepat membesar',
    '🟡 SEDANG 2–7 — Cukup mendukung penyebaran api',
    '🟢 RENDAH < 2 — Relatif kurang mendukung',
    '',
    '## KLASIFIKASI FFMC (Fine Fuel Moisture Code)',
    '🔴 EKSTRIM ≥ 89 — Permukaan sangat kering, mudah tersulut',
    '🟠 TINGGI 83–89 — Kering, percikan kecil berisiko',
    '🟡 SEDANG 76–83 — Cukup kering',
    '🟢 RENDAH < 76 — Masih lembab',
    '',
    '## DATA SAAT INI (dari SPARTAN BMKG)',
    dataContext,
    '',
    '## WILAYAH YANG ADA',
    'Kota Samarinda, Kota Balikpapan, Kota Bontang, Kab. Berau,',
    'Kab. Kutai Barat, Kab. Kutai Kartanegara (Kukar), Kab. Kutai Timur (Kutim),',
    'Kab. Mahakam Ulu (Mahulu), Kab. Paser, Kab. Penajam Paser Utara (PPU).',
    '',
    'Singkatan: Kukar=Kutai Kartanegara, Kutim=Kutai Timur, Kubar=Kutai Barat, Mahulu=Mahakam Ulu, PPU=Penajam Paser Utara.',
    '',
    'Hari ini = offset 0, Besok = offset 1, Lusa = offset 2 dalam data.'
  ].join('\n');
}

// ============================================================
// CALL MIMO AI API (OpenAI-compatible)
// ============================================================

function callGemini(systemPrompt, history, query) {
  var url = 'https://api.xiaomimimo.com/v1/chat/completions';

  // Bangun messages array
  var messages = [];
  messages.push({ role: 'system', content: systemPrompt });

  // Riwayat chat (max 6 pesan)
  var recentHistory = history.slice(-6);
  for (var i = 0; i < recentHistory.length; i++) {
    messages.push({
      role: recentHistory[i].role === 'user' ? 'user' : 'assistant',
      content: recentHistory[i].text
    });
  }

  // Query terbaru
  messages.push({ role: 'user', content: query });

  var payload = {
    model: MODEL,
    messages: messages,
    temperature: 0.4,
    max_tokens: 1024
  };

  var options = {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + GEMINI_API_KEY,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    timeout: 25
  };

  var resp = UrlFetchApp.fetch(url, options);
  var result = JSON.parse(resp.getContentText());

  // Cek error
  if (result.error) {
    throw new Error('MiMo error: ' + JSON.stringify(result.error));
  }

  // Ambil teks respons (OpenAI format)
  if (result.choices && result.choices[0] && result.choices[0].message) {
    return result.choices[0].message.content.trim();
  }

  throw new Error('Respon tidak dikenal: ' + JSON.stringify(result).substring(0, 500));
}
