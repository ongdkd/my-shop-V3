// identify-product — admin-only product lookup for the "add product" screens.
// Photo in → Google Cloud Vision Web Detection finds store pages showing the
// same product → Gemini Flash-Lite reads the photo + page titles and writes a
// clean name and picks the best store photo → out: { name, imageUrl, pageUrl }.
// Without GOOGLE_VISION_API_KEY (needs billing) it runs Gemini-only: Gemini
// searches Google itself and the photo comes from a source page (free tier).
// The Google keys stay in Supabase secrets; the browser never sees them.
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const VISION_KEY = Deno.env.get("GOOGLE_VISION_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// Alias that tracks Google's current Flash-Lite; override with a secret if needed
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-lite-latest";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Photo = { mime: string; b64: string };
type Candidate = { title: string; pageUrl: string; imageUrl: string };

// Data URL from the app, or an https image URL (an earlier pick) → base64
async function loadPhoto(image: string): Promise<Photo | null> {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(image);
  if (m) return { mime: m[1], b64: m[2] };
  if (!/^https:\/\//i.test(image)) return null;
  const r = await fetch(image, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 8_000_000) return null;
  return { mime: r.headers.get("content-type")?.split(";")[0] || "image/jpeg", b64: encodeBase64(buf) };
}

const clean = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const httpsOnly = (u?: string) => (u && u.startsWith("https://") ? u : "");

// Store pages that show this product, each with its best copy of the photo
type Clues = { guess: string; entities: string[]; titles: string[]; candidates: Candidate[] };
async function webDetect(photo: Photo): Promise<Clues> {
  const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ image: { content: photo.b64 }, features: [{ type: "WEB_DETECTION", maxResults: 10 }] }],
    }),
  });
  const body = await r.json().catch(() => ({}));
  // Surface Google's reason (API not enabled, billing off, key restricted…)
  if (!r.ok) throw new Error(`Cloud Vision ${r.status}: ${body.error?.message ?? ""}`);
  const res0 = body.responses?.[0] ?? {};
  if (res0.error) throw new Error(`Cloud Vision: ${res0.error.message}`);
  const web = res0.webDetection ?? {};
  const candidates: Candidate[] = []; // pages whose photo we can use
  const titles: string[] = [];        // every matching page title — naming clues even without a usable photo
  for (const p of web.pagesWithMatchingImages ?? []) {
    if (!p.pageTitle) continue;
    const title = clean(p.pageTitle);
    if (titles.length < 12) titles.push(title);
    const img = httpsOnly(p.fullMatchingImages?.[0]?.url) || httpsOnly(p.partialMatchingImages?.[0]?.url);
    if (img && candidates.length < 8) candidates.push({ title, pageUrl: p.url, imageUrl: img });
  }
  // Short labels Google links to the image (series, maker, character…)
  const entities = (web.webEntities ?? [])
    .map((e: { description?: string }) => clean(e.description ?? "")).filter(Boolean).slice(0, 10);
  return { guess: clean(web.bestGuessLabels?.[0]?.label ?? ""), entities, titles, candidates };
}

// Shop naming format: "[Series] ประเภทสินค้า Product name", e.g.
// "[Codename: Anastasia] ซองสุ่มการ์ด Trading Photo Card Vol. 2 (Set 2) by Mercury Studio".
// Gemini returns the three parts; formatName joins them so the format never drifts.
const NAME_PARTS = `Return the name in three parts:
- series: the franchise / series / title the goods belong to, using its official English title (e.g. "Codename: Anastasia", "Blue Lock", "Hatsune Miku"); keep the original only if no English title exists. Empty if none.
- type_th: the product type in short everyday Thai, e.g. ซองสุ่มการ์ด (random card pack), การ์ด, สแตนดี้อะคริลิค, พวงกุญแจ, เข็มกลัด, กล่องสุ่ม, ฟิกเกอร์, ตุ๊กตา, โปสเตอร์, สติกเกอร์, แฟ้ม, หนังสือ. Use one of these when it fits.
- product: the specific product IN ENGLISH, without repeating the series: English product type (e.g. "Trading Photo Card", "Acrylic Stand", "Can Badge"), volume / set / edition number written the English way ("Vol. 2", "Set 2" — never "第2弾" or "第二弹"), character name(s) in their usual English spelling, and "by <maker>" when listings name the maker. Use the official English name when one exists; otherwise translate Chinese / Japanese / Korean titles to English. No Chinese, Japanese or Korean characters in this part. No shop names, prices, shipping notes, hashtags or 【】 tags.
Keep the whole name under 120 characters.`;

function formatName(out: { series?: unknown; type_th?: unknown; product?: unknown }): string {
  const series = String(out.series ?? "").trim().replace(/^\[|\]$/g, "");
  const parts = [series ? `[${series}]` : "", String(out.type_th ?? "").trim(), String(out.product ?? "").trim()];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 160);
}

// Gemini looks at the photo + search clues → clean name + best candidate photo
async function pickName(photo: Photo, clues: Clues) {
  const { guess, entities, titles, candidates } = clues;
  const prompt = `This is a product photo from a Thai shop owner adding stock (mostly anime/game character goods: acrylic stands, keychains, badges, photo cards, figures, plush — but could be anything).
Google reverse image search found this:
- Best guess: "${guess || "none"}"
- Related labels: ${entities.join(", ") || "none"}
- Titles of pages showing the same image:
${titles.map((t) => "  • " + t).join("\n") || "  (none)"}

Name the product using the clues above together with what is printed on the item. If the clues disagree, prefer what several titles agree on.
${NAME_PARTS}

Pages whose product photo can be used:
${candidates.map((c, i) => `${i}. ${c.title}`).join("\n") || "(none)"}
image_index = the number of the page above that shows THIS exact product, or -1 if none clearly does.`;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: photo.mime, data: photo.b64 } }, { text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              series: { type: "STRING" }, type_th: { type: "STRING" }, product: { type: "STRING" },
              image_index: { type: "INTEGER" },
            },
            required: ["series", "type_th", "product", "image_index"],
          },
        },
      }),
    },
  );
  const body = await r.json().catch(() => ({}));
  // Surface Google's reason (bad model name, free-tier quota used up, key problem…)
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${body.error?.message ?? ""}`);
  const out = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
  return { name: formatName(out), index: Number(out.image_index) };
}

// Main product photo of a store page, via its og:image / twitter:image tag
async function pageImage(pageUrl: string): Promise<{ imageUrl: string; pageUrl: string }> {
  try {
    const r = await fetch(pageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OrderHub/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { imageUrl: "", pageUrl: "" };
    const html = (await r.text()).slice(0, 600_000);
    const tag = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/i);
    const content = tag && tag[0].match(/content=["']([^"']+)["']/i);
    const img = content ? new URL(content[1].replace(/&amp;/g, "&"), r.url).href : "";
    return { imageUrl: httpsOnly(img), pageUrl: r.url }; // r.url = page after redirects
  } catch {
    return { imageUrl: "", pageUrl: "" };
  }
}

// No Vision key (no billing): Gemini reads the photo and searches Google itself,
// then we take the product photo from the first source page that has one.
// ponytail: og:image of a search source, weaker than reverse image search; add the Vision key to upgrade
async function geminiSearch(photo: Photo) {
  const prompt = `This is a product photo from a Thai shop owner adding stock (mostly anime/game character goods: acrylic stands, keychains, badges, figures, plush — but could be anything).
Read the packaging text, logos, character and series, then search Google to find this exact product on a store or maker page.
${NAME_PARTS}
Reply with one line of JSON only: {"series": "...", "type_th": "...", "product": "..."}`;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: photo.mime, data: photo.b64 } }, { text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    },
  );
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${body.error?.message ?? ""}`);
  const cand = body.candidates?.[0] ?? {};
  const text = (cand.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  const json = text.match(/\{[^{}]*"product"[^{}]*\}/g);
  let name = "";
  try { name = json ? formatName(JSON.parse(json[json.length - 1])) : ""; } catch { /* malformed JSON → no name */ }
  // Sources Google Search returned (redirect links that land on the real page)
  const sources: string[] = (cand.groundingMetadata?.groundingChunks ?? [])
    .map((c: { web?: { uri?: string } }) => c.web?.uri ?? "").filter(Boolean).slice(0, 4);
  for (const src of sources) {
    const hit = await pageImage(src);
    if (hit.imageUrl) return { name, ...hit };
  }
  return { name, imageUrl: "", pageUrl: "" };
}

// One variant of a known product (a card in a set, a colour…): return only
// what tells it apart, e.g. "Zhenya" — the product name is already set.
async function variantName(photo: Photo, product: string): Promise<string> {
  const prompt = `This photo shows ONE variant of the product "${product.slice(0, 200) || "unknown"}" (mostly anime/game character goods sold in Thailand).
Name only what makes this variant different from the others in the same product: the character name(s) in their usual English spelling, or the colour / design / version (e.g. "Zhenya", "Kwon Taekjoo", "Red", "Secret ver."). Search Google if you need to identify a character.
Do not repeat the product name. Under 40 characters.
Reply with one line of JSON only: {"variant": "..."}`;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: photo.mime, data: photo.b64 } }, { text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    },
  );
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${body.error?.message ?? ""}`);
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  const json = text.match(/\{[^{}]*"variant"[^{}]*\}/g);
  try { return json ? String(JSON.parse(json[json.length - 1]).variant || "").trim().slice(0, 60) : ""; } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Admins only — the same is_admin() check the web app uses
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (isAdmin !== true) return reply({ error: "Forbidden — ต้องเข้าสู่ระบบแอดมิน" }, 403);
  if (!GEMINI_KEY) return reply({ error: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY" });

  let input: { image?: unknown; variant?: unknown; product?: unknown } = {};
  try { input = await req.json(); } catch { /* bad body */ }
  const photo = await loadPhoto(String(input.image || "")).catch(() => null);
  if (!photo) return reply({ error: "ไม่พบรูปภาพ" }, 400);

  try {
    if (input.variant) {
      const name = await variantName(photo, String(input.product || ""));
      if (!name) return reply({ error: "ระบุตัวเลือกไม่ได้ ลองถ่ายให้ชัดขึ้น" });
      return reply({ name, imageUrl: "", pageUrl: "" });
    }
    if (!VISION_KEY) {
      const g = await geminiSearch(photo);
      if (!g.name) return reply({ error: "ระบุสินค้าไม่ได้ ลองถ่ายให้เห็นแพ็กเกจชัดขึ้น" });
      return reply(g);
    }
    const clues = await webDetect(photo);
    // No silent fallback to a raw page title — the first match can be an
    // unrelated blog/Pinterest page. Gemini errors reach the admin as a toast.
    const { name, index } = await pickName(photo, clues);
    const pick = clues.candidates[index];
    if (!name) return reply({ error: "ระบุสินค้าไม่ได้ ลองถ่ายให้เห็นแพ็กเกจชัดขึ้น" });
    return reply({ name, imageUrl: pick?.imageUrl ?? "", pageUrl: pick?.pageUrl ?? "" });
  } catch (e) {
    return reply({ error: "ค้นหาไม่สำเร็จ: " + String((e as Error).message || e) });
  }
});
