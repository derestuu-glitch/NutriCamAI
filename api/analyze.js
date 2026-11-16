/**
 * Vercel Serverless Function: /api/analyze
 * Berfungsi sebagai proxy aman antara browser (frontend) dan Google Gemini 3.8 Flash API.
 * - Membaca GEMINI_API_KEY dari Vercel Environment Variables (tidak pernah terekspos ke klien).
 * - Menerima gambar terkompresi (Base64) dari frontend.
 * - Memaksa model Gemini 3.8 Flash mengembalikan JSON terstruktur (Structured Outputs).
 */

module.exports = async (req, res) => {
  // Header CORS standar agar aman diakses dari domain frontend Vercel maupun pengujian lokal
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Hanya izinkan metode HTTP POST
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metode HTTP tidak diizinkan. Gunakan metode POST."
    });
  }

  // Ambil API Key secara aman dan bersihkan spasi/baris baru tersembunyi
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(500).json({
      error: "Konfigurasi server belum lengkap: GEMINI_API_KEY belum diatur pada Environment Variables Vercel."
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const {
      imageBase64,
      mimeType = "image/jpeg",
      scanType = "food",
      userContext = {}
    } = body;

    // Validasi payload gambar Base64
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({
        error: "Data gambar terkompresi (imageBase64) tidak ditemukan pada permintaan."
      });
    }

    // Hapus prefix data URL serta whitespace agar string Base64 murni
    const cleanBase64 = imageBase64
      .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "")
      .replace(/\s+/g, "")
      .trim();

    let systemInstructionText = "";
    let userPromptText = "";
    let responseSchema = null;

    if (scanType === "body") {
      // =====================================================================
      // MODE 1: PEMINDAIAN KOMPOSISI TUBUH & SOMATOTYPE (BODY SCAN AI)
      // =====================================================================
      const height = Number(userContext.height) || 170;
      const weight = Number(userContext.weight) || 65;
      const age = Number(userContext.age) || 26;
      const genderLabel = userContext.gender === "female" ? "Perempuan" : "Laki-laki";
      const bmiVal = Number(userContext.bmi) || (weight / Math.pow(height / 100, 2));

      systemInstructionText =
        `Anda adalah pelatih kebugaran bersertifikat dan pakar komposisi tubuh AI. ` +
        `Data biometrik pengguna: Tinggi ${height} cm, Berat ${weight} kg, Umur ${age} tahun, ` +
        `Jenis Kelamin ${genderLabel}, BMI numerik ${bmiVal.toFixed(1)}. ` +
        `Analisis foto postur tubuh pengguna dalam Bahasa Indonesia untuk memperkirakan tipe tubuh/somatotype ` +
        `(Ectomorph, Mesomorph, Endomorph, atau kombinasi), estimasi persentase lemak tubuh (%), ` +
        `serta status keidealan visual melampaui keterbatasan angka BMI semata.`;

      userPromptText =
        "Analisis tipe tubuh, estimasi persentase lemak tubuh, perbandingan dengan BMI numerik, " +
        "saran mode kalori (defisit, normal/TDEE, atau surplus), penjelasan detail, serta rekomendasi latihan dan gizi.";

      responseSchema = {
        type: "OBJECT",
        properties: {
          status_keidealan: { type: "STRING" },
          tipe_tubuh_somatotype: { type: "STRING" },
          estimasi_lemak_persen: { type: "NUMBER" },
          perbandingan_dengan_bmi: { type: "STRING" },
          saran_mode_kalori: { type: "STRING" },
          penjelasan_detail: { type: "STRING" },
          rekomendasi_latihan_gizi: { type: "STRING" }
        },
        required: [
          "status_keidealan",
          "tipe_tubuh_somatotype",
          "estimasi_lemak_persen",
          "perbandingan_dengan_bmi",
          "saran_mode_kalori",
          "penjelasan_detail",
          "rekomendasi_latihan_gizi"
        ]
      };
    } else {
      // =====================================================================
      // MODE 2 (DEFAULT): PEMINDAIAN GIZI & GRAMASI MAKANAN
      // =====================================================================
      const userName = userContext.name || "Pengguna";
      const height = Number(userContext.height) || 170;
      const weight = Number(userContext.weight) || 65;
      const bmi = Number(userContext.bmi) || 22.5;
      const bodyType = userContext.bodyType || "Standar";
      const targetCalories = Number(userContext.activeTargetCalories) || 2000;
      const remainingKcal = userContext.remainingKcal !== undefined ? Number(userContext.remainingKcal) : targetCalories;

      systemInstructionText =
        `Anda adalah NutriCam AI Pro, ahli gizi klinis Indonesia. Analisis foto piring makanan atau minuman dalam Bahasa Indonesia. ` +
        `Identifikasi setiap komponen lauk/makanan secara terpisah, estimasikan berat gramasi tiap komponen dengan acuan diameter piring standar ~25 cm, ` +
        `berikan nilai nutrisi akurat per 100 gram untuk tiap komponen, skor gizi "Isi Piringku" (1-10), serta evaluasi personal. ` +
        `Profil pengguna saat ini: Nama ${userName}, Tinggi ${height} cm, Berat ${weight} kg, IMT ${bmi.toFixed(1)}, ` +
        `Tipe Tubuh ${bodyType}, Target Kalori Harian ${targetCalories} kkal, Sisa Kuota Kalori Hari Ini ${remainingKcal} kkal. ` +
        `Jika foto bukan makanan atau minuman yang dapat dikonsumsi, set is_food menjadi false dan isi alasan_bukan_makanan.`;

      userPromptText =
        "Pindai hidangan pada foto ini secara teliti, pecah menjadi daftar komponen makanan beserta estimasi berat gramasi " +
        "dan nilai gizi per 100g, hitung gula (g), natrium (mg), indeks glikemik, skor Isi Piringku, serta berikan pendapat ahli gizi personal.";

      responseSchema = {
        type: "OBJECT",
        properties: {
          is_food: { type: "BOOLEAN" },
          alasan_bukan_makanan: { type: "STRING" },
          nama_hidangan: { type: "STRING" },
          acuan_skala_visual: { type: "STRING" },
          komponen_makanan: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                nama: { type: "STRING" },
                estimasi_gram: { type: "NUMBER" },
                kalori_per_100g: { type: "NUMBER" },
                protein_per_100g: { type: "NUMBER" },
                karbo_per_100g: { type: "NUMBER" },
                lemak_per_100g: { type: "NUMBER" },
                serat_per_100g: { type: "NUMBER" },
                catatan_visual: { type: "STRING" }
              },
              required: [
                "nama",
                "estimasi_gram",
                "kalori_per_100g",
                "protein_per_100g",
                "karbo_per_100g",
                "lemak_per_100g",
                "serat_per_100g",
                "catatan_visual"
              ]
            }
          },
          gula_g: { type: "NUMBER" },
          natrium_mg: { type: "NUMBER" },
          indeks_glikemik: { type: "STRING" },
          skor_isi_piringku: { type: "INTEGER" },
          pendapat_ahli_gizi: {
            type: "OBJECT",
            properties: {
              sapaan_personal: { type: "STRING" },
              evaluasi_tujuan: { type: "STRING" },
              kelebihan_nutrisi: { type: "ARRAY", items: { type: "STRING" } },
              hal_diperhatikan: { type: "ARRAY", items: { type: "STRING" } },
              saran_konkret: { type: "ARRAY", items: { type: "STRING" } }
            },
            required: [
              "sapaan_personal",
              "evaluasi_tujuan",
              "kelebihan_nutrisi",
              "hal_diperhatikan",
              "saran_konkret"
            ]
          }
        },
        required: [
          "is_food",
          "nama_hidangan",
          "acuan_skala_visual",
          "komponen_makanan",
          "gula_g",
          "natrium_mg",
          "indeks_glikemik",
          "skor_isi_piringku",
          "pendapat_ahli_gizi"
        ]
      };
    }

    const geminiPayload = {
      systemInstruction: {
        parts: [{ text: systemInstructionText }]
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: userPromptText },
            {
              inlineData: {
                mimeType: mimeType || "image/jpeg",
                data: cleanBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: responseSchema
      }
    };

    // Gunakan model utama gemini-3.8-flash dengan fallback otomatis jika diperlukan
    const candidateModels = [
      "gemini-3.8-flash",
      "gemini-3-flash",
      "gemini-2.5-flash"
    ];

    let lastStatus = 502;
    let lastErrorMessage = "Gagal memproses permintaan ke Gemini API.";

    for (const modelName of candidateModels) {
      const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const geminiResponse = await fetch(geminiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload)
      });

      const rawGeminiText = await geminiResponse.text();
      let geminiData = null;
      try {
        geminiData = JSON.parse(rawGeminiText);
      } catch (e) {
        lastStatus = 502;
        lastErrorMessage = "Respons dari server Google Gemini tidak berformat JSON.";
        continue;
      }

      if (!geminiResponse.ok) {
        lastStatus = geminiResponse.status;
        lastErrorMessage = geminiData?.error?.message || `Error dari model ${modelName}`;

        // Jika model tidak tersedia untuk akun ini, coba model berikutnya dalam daftar
        const isModelUnavailable =
          geminiResponse.status === 404 ||
          /no longer available|not found|not supported|deprecated/i.test(lastErrorMessage);

        if (isModelUnavailable) {
          continue;
        }

        return res.status(lastStatus).json({ error: lastErrorMessage });
      }

      const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        lastStatus = 502;
        lastErrorMessage = `Model ${modelName} mengembalikan respons kosong.`;
        continue;
      }

      // Bersihkan pembungkus markdown ```json jika masih ada dan parse ke objek JSON murni
      const sanitizedJsonText = rawText
        .replace(/^```json\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      const structuredJson = JSON.parse(sanitizedJsonText);
      return res.status(200).json(structuredJson);
    }

    return res.status(lastStatus).json({ error: lastErrorMessage });
  } catch (error) {
    return res.status(500).json({
      error: "Terjadi kesalahan pada server proxy saat memproses gambar.",
      detail: error.message
    });
  }
};
