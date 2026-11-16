/**
 * Vercel Serverless Function: /api/analyze
 * Proxy aman antara browser (frontend) dan Google Gemini API.
 * Dioptimalkan untuk latensi rendah (2-3 detik) dengan menonaktifkan thinking tokens
 * dan menggunakan model aktif Gemini 2.5 Flash secara langsung tanpa jeda 404.
 */

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metode HTTP tidak diizinkan. Gunakan metode POST."
    });
  }

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

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({
        error: "Data gambar terkompresi (imageBase64) tidak ditemukan pada permintaan."
      });
    }

    const cleanBase64 = imageBase64
      .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "")
      .replace(/\s+/g, "")
      .trim();

    let systemInstructionText = "";
    let userPromptText = "";
    let responseSchema = null;

    if (scanType === "body") {
      const height = Number(userContext.height) || 170;
      const weight = Number(userContext.weight) || 65;
      const age = Number(userContext.age) || 26;
      const genderLabel = userContext.gender === "female" ? "Perempuan" : "Laki-laki";
      const bmiVal = Number(userContext.bmi) || (weight / Math.pow(height / 100, 2));

      systemInstructionText =
        `Pakar komposisi tubuh AI. Data pengguna: Tinggi ${height} cm, Berat ${weight} kg, Umur ${age} th, ` +
        `${genderLabel}, BMI ${bmiVal.toFixed(1)}. Analisis foto tubuh dalam Bahasa Indonesia secara ringkas dan akurat.`;

      userPromptText =
        "Tentukan tipe tubuh (somatotype), estimasi % lemak tubuh, perbandingan vs BMI, saran mode kalori (defisit/normal/surplus), penjelasan singkat, dan rekomendasi latihan/gizi.";

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
      const userName = userContext.name || "Pengguna";
      const height = Number(userContext.height) || 170;
      const weight = Number(userContext.weight) || 65;
      const bmi = Number(userContext.bmi) || 22.5;
      const bodyType = userContext.bodyType || "Standar";
      const targetCalories = Number(userContext.activeTargetCalories) || 2000;
      const remainingKcal = userContext.remainingKcal !== undefined ? Number(userContext.remainingKcal) : targetCalories;

      systemInstructionText =
        `Ahli gizi klinis NutriCam AI. Analisis foto makanan/minuman dalam Bahasa Indonesia secara ringkas. ` +
        `Pecah tiap komponen makanan, estimasi gramasi (acuan piring ~25 cm), nilai gizi per 100g, skor Isi Piringku (1-10), dan saran singkat. ` +
        `Profil: ${userName}, ${height}cm, ${weight}kg, IMT ${bmi.toFixed(1)}, Tipe ${bodyType}, Target ${targetCalories} kkal, Sisa ${remainingKcal} kkal. ` +
        `Jika bukan makanan/minuman, set is_food=false, komponen_makanan=[], dan isi alasan_bukan_makanan.`;

      userPromptText =
        "Analisis makanan pada foto ini menjadi JSON ringkas dan akurat.";

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

    // Gunakan langsung model aktif tercepat dengan thinkingBudget: 0 agar tidak membuang waktu 404/thinking
    const candidateConfigs = [
      { model: "gemini-2.5-flash", disableThinking: true },
      { model: "gemini-2.0-flash", disableThinking: false }
    ];

    let lastStatus = 502;
    let lastErrorMessage = "Gagal memproses permintaan ke Gemini API.";

    for (const cfg of candidateConfigs) {
      const generationConfig = {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: responseSchema
      };

      if (cfg.disableThinking) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
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
        generationConfig
      };

      const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
        lastErrorMessage = geminiData?.error?.message || `Error dari model ${cfg.model}`;

        if (geminiResponse.status === 404 || geminiResponse.status === 400 || geminiResponse.status >= 500) {
          continue;
        }

        return res.status(lastStatus).json({ error: lastErrorMessage });
      }

      const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        lastStatus = 502;
        lastErrorMessage = `Model ${cfg.model} mengembalikan respons kosong.`;
        continue;
      }

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
