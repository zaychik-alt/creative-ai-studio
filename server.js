import "dotenv/config";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import rateLimit from "express-rate-limit";
import OpenAI, { toFile } from "openai";

const app = express();
const port = Number(process.env.PORT || 3000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    cb(allowed.includes(file.mimetype) ? null : new Error("Formato no admitido. Usa PNG, JPG o WEBP."), allowed.includes(file.mimetype));
  }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  const expected = process.env.STUDIO_PASSWORD;
  if (!expected) return res.status(503).send("CREATIVE AI STUDIO aún no está configurado.");
  const header = req.headers.authorization || "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (match) {
    let decoded = "";
    try { decoded = Buffer.from(match[1], "base64").toString("utf8"); } catch {}
    const separator = decoded.indexOf(":");
    const supplied = Buffer.from(separator >= 0 ? decoded.slice(separator + 1) : "");
    const target = Buffer.from(expected);
    if (supplied.length === target.length && require("node:crypto").timingSafeEqual(supplied, target)) return next();
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="CREATIVE AI STUDIO", charset="UTF-8"');
  return res.status(401).send("Acceso privado. Introduce la contraseña de CREATIVE AI STUDIO.");
});
app.use(express.static("public"));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true, legacyHeaders: false }));

function client() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("Falta configurar OPENAI_API_KEY en el archivo .env.");
    error.status = 503;
    throw error;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

app.get("/api/status", (_req, res) => {
  res.json({ configured: Boolean(process.env.OPENAI_API_KEY) });
});

app.post("/api/images", upload.single("reference"), async (req, res) => {
  try {
    const prompt = String(req.body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Escribe una descripción para la imagen." });

    const openai = client();
    const model = req.body.model === "gpt-image-2.5-flare" ? "gpt-image-2.5-flare" : "gpt-image-2.5-sunburst";
    const size = ["1024x1024", "1536x1024", "1024x1536"].includes(req.body.size) ? req.body.size : "1024x1024";
    const quality = ["low", "medium", "high"].includes(req.body.quality) ? req.body.quality : "high";

    let result;
    if (req.file) {
      const image = await toFile(req.file.buffer, req.file.originalname || "reference.png", { type: req.file.mimetype });
      result = await openai.images.edit({ model, image, prompt, size, quality, output_format: "png" });
    } else {
      result = await openai.images.generate({ model, prompt, size, quality, output_format: "png" });
    }

    const item = result.data?.[0];
    if (!item?.b64_json) throw new Error("La API no devolvió una imagen.");
    res.json({ image: `data:image/png;base64,${item.b64_json}`, revisedPrompt: item.revised_prompt || null });
  } catch (error) {
    console.error("Image API:", error);
    res.status(error.status || 500).json({ error: error.message || "No se pudo generar la imagen." });
  }
});

app.post("/api/videos", upload.single("reference"), async (req, res) => {
  try {
    const prompt = String(req.body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Escribe qué debe ocurrir en el video." });

    const model = req.body.model === "sora-2-pro" ? "sora-2-pro" : "sora-2";
    const seconds = ["4", "8", "12"].includes(req.body.seconds) ? req.body.seconds : "4";
    const size = ["720x1280", "1280x720"].includes(req.body.size) ? req.body.size : "1280x720";

    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("seconds", seconds);
    form.append("size", size);

    if (req.file) {
      form.append("input_reference", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || "reference.png");
    }

    const response = await fetch("https://api.openai.com/v1/videos", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "No se pudo iniciar la generación del video.");
    res.json({ id: data.id, status: data.status || "queued" });
  } catch (error) {
    console.error("Video API:", error);
    res.status(500).json({ error: error.message || "No se pudo iniciar el video." });
  }
});

app.get("/api/videos/:id", async (req, res) => {
  try {
    const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(req.params.id)}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "No se pudo consultar el video.");
    res.json({ id: data.id, status: data.status, error: data.error || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/videos/:id/content", async (req, res) => {
  try {
    const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(req.params.id)}/content`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || "El video todavía no está disponible.");
    }
    res.setHeader("Content-Type", response.headers.get("content-type") || "video/mp4");
    res.setHeader("Content-Disposition", 'inline; filename="creative-ai-video.mp4"');
    const bytes = Buffer.from(await response.arrayBuffer());
    res.send(bytes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use((error, _req, res, _next) => {
  res.status(400).json({ error: error.message || "Solicitud no válida." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`CREATIVE AI STUDIO disponible en http://localhost:${port}`);
});
