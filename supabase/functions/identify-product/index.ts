// identify-product — admin-only product lookup for the "add product" screens.
// Photo in → Google Cloud Vision Web Detection finds store pages showing the
// same product → Gemini Flash-Lite reads the photo + page titles and writes a
// clean name and picks the store photo that matches → out: { name, imageUrl, pageUrl }.
// No match → Gemini searches Google (also in Korean / Japanese) and checks those photos.
// Without GOOGLE_VISION_API_KEY (needs billing) it runs Gemini-only: Gemini
// searches Google itself and the photo comes from a source page (free tier).
// The Google keys stay in Supabase secrets; the browser never sees them.
import { createClient } from "npm:@supabase/supabase-js@2";
// Built-in base64 (no jsr.io download at deploy time; that fetch can time out)
function encodeBase64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  // chunks keep String.fromCharCode's argument list small
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

const VISION_KEY = Deno.env.get("GOOGLE_VISION_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// Alias that tracks Google's current Flash-Lite; override with a secret if needed
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-lite-latest";
// "Is this the same product?" needs a stronger eye than naming does. It runs on
// its own model, so it also has its own free per-minute quota.
const MATCH_MODEL = Deno.env.get("GEMINI_MATCH_MODEL") || "gemini-flash-latest";

// One Gemini call. The free tier allows only a few requests per minute and a
// lookup makes up to 3, so on a per-minute 429 wait as long as Google asks
// (max 20 s) and retry once. A daily-limit 429 is returned straight away.
async function gemini(payload: unknown, model = GEMINI_MODEL, retry = true): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify(payload),
    });
    if (r.status !== 429 || attempt > 0 || !retry) return r;
    const info = await r.clone().text();
    if (/PerDay/i.test(info)) return r;
    const wait = parseFloat(/"retryDelay":\s*"([\d.]+)s"/.exec(info)?.[1] ?? "") || 10;
    await new Promise((ok) => setTimeout(ok, Math.min(20, wait) * 1000));
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
// Supabase cuts a request off after a time limit; every slow step gets a
// budget so the admin always gets the name back, with or without a photo
const NO_PHOTO = { imageUrl: "", pageUrl: "", imageData: "" };
function within<T>(ms: number, work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([work.catch(() => fallback), new Promise<T>((ok) => setTimeout(() => ok(fallback), Math.max(0, ms)))]);
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Photo = { mime: string; b64: string };
type Candidate = { title: string; pageUrl: string; imageUrl: string; photo?: Photo };

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
// Many shops (Coupang, Naver…) refuse requests that do not look like a browser
const BROWSER = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "ko,ja;q=0.9,en;q=0.8",
};
const httpsOnly = (u?: string) => (u && u.startsWith("https://") ? u : "");
// Video / social sites: their preview image is a thumbnail, not a product photo
const NOT_PRODUCT = /(^|.)(youtube.com|youtu.be|ytimg.com|tiktok.com|tiktokcdn.com|instagram.com|cdninstagram.com|facebook.com|fbcdn.net|x.com|twitter.com|twimg.com|reddit.com|redd.it)$/i;
const productUrl = (u: string) => { try { return !NOT_PRODUCT.test(new URL(u).hostname); } catch { return false; } };

// Store pages that show this product, each with its best copy of the photo
type Clues = { guess: string; entities: string[]; titles: string[]; candidates: Candidate[] };
async function webDetect(photo: Photo): Promise<Clues> {
  const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ image: { content: photo.b64 }, features: [{ type: "WEB_DETECTION", maxResults: 30 }] }],
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
  const pagesNoImage: { title: string; pageUrl: string }[] = [];
  for (const p of web.pagesWithMatchingImages ?? []) {
    if (!p.pageTitle) continue;
    const title = clean(p.pageTitle);
    if (titles.length < 12) titles.push(title);
    const img = httpsOnly(p.fullMatchingImages?.[0]?.url) || httpsOnly(p.partialMatchingImages?.[0]?.url);
    if (img) candidates.push({ title, pageUrl: p.url, imageUrl: img });
    else if (httpsOnly(p.url)) pagesNoImage.push({ title, pageUrl: p.url });
  }
  // A photo taken in the shop rarely has exact copies online; "visually
  // similar" results are usually store photos of the same item
  for (const v of web.visuallySimilarImages ?? []) {
    const img = httpsOnly(v.url);
    if (img) candidates.push({ title: "", pageUrl: "", imageUrl: img });
  }
  // Matching pages without a listed image → their main (og:image) photo
  if (candidates.length < 4) {
    const extra = await Promise.all(pagesNoImage.slice(0, 3).map((p) => pageImage(p.pageUrl).then((h) => ({ ...p, ...h }))));
    for (const e of extra) if (e.imageUrl) candidates.push({ title: e.title, pageUrl: e.pageUrl, imageUrl: e.imageUrl });
  }
  // Short labels Google links to the image (series, maker, character…)
  const entities = (web.webEntities ?? [])
    .map((e: { description?: string }) => clean(e.description ?? "")).filter(Boolean).slice(0, 10);
  // Download the first few that really are images Gemini can read, so it can
  // compare them with the photo instead of guessing from page titles.
  // Ones that fail here would also fail when Cloudinary copies them on save.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => !seen.has(c.imageUrl) && seen.add(c.imageUrl)).slice(0, 8);
  const why: string[] = [];
  const loaded = await Promise.all(unique.map(async (c) => ({ ...c, photo: (await fetchImage(c.imageUrl, why)) ?? undefined })));
  // ponytail: 6 photos per call keeps Gemini fast and cheap; raise if good matches are missed
  const usable = loaded.filter((c) => c.photo).slice(0, 6);
  // Supabase → Edge Functions → identify-product → Logs: where a photo got lost
  console.log("vision", { pages: titles.length, candidates: unique.length, downloaded: usable.length, failed: why.slice(0, 6) });
  return { guess: clean(web.bestGuessLabels?.[0]?.label ?? ""), entities, titles, candidates: usable };
}

// A candidate product photo, only if it is a reasonably sized image Gemini accepts
async function fetchImage(url: string, why?: string[]): Promise<Photo | null> {
  const fail = (reason: string) => { why?.push(new URL(url).hostname + " " + reason); return null; };
  if (!productUrl(url)) return fail("video/social");
  try {
    const r = await fetch(url, { headers: BROWSER, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return fail("HTTP " + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength < 3_000) return fail("too small");
    if (buf.byteLength > 2_000_000) return fail("too big"); // CPU: converting big files counts against the per-request limit
    // Judge the file itself: many CDNs label photos image/jpg or octet-stream
    const mime = sniff(buf);
    if (!mime) return fail("not jpeg/png/webp (" + (r.headers.get("content-type") ?? "?") + ")");
    return { mime, b64: encodeBase64(buf) };
  } catch (e) {
    return fail((e as Error).name === "TimeoutError" ? "timeout" : "error");
  }
}
const sniff = (b: Uint8Array) =>
  b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
  : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "image/png"
  : String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP" ? "image/webp"
  : "";

// Shop naming format: "[Series] ประเภทสินค้า Product name", e.g.
// "[Codename: Anastasia] ซองสุ่มการ์ด Trading Photo Card Vol. 2 (Set 2) by Mercury Studio".
// Gemini returns the three parts; formatName joins them so the format never drifts.
const NAME_PARTS = `Return the name in three parts:
- series: the franchise / series / title the goods belong to, using its official English title (e.g. "Codename: Anastasia", "Blue Lock", "Hatsune Miku"); keep the original only if no English title exists. This is the story / anime / game / webtoon, NOT the product line or brand of the goods: a card line such as "Highlight Pick" belongs in product, while the webtoon / anime title printed on THIS box is the series. Never guess a series that is not printed on the item or named by the search clues. Read titles printed in Korean / Japanese / Chinese and give their official English title. Empty if none.
- type_th: the product type in short everyday Thai, e.g. ซองสุ่มการ์ด (random card pack), การ์ด, สแตนดี้อะคริลิค, พวงกุญแจ, เข็มกลัด, กล่องสุ่ม, ฟิกเกอร์, ตุ๊กตา, โปสเตอร์, สติกเกอร์, แฟ้ม, หนังสือ. Use one of these when it fits.
- product: the specific product IN ENGLISH, without repeating the series: English product type (e.g. "Trading Photo Card", "Acrylic Stand", "Can Badge"), volume / set / edition number written the English way ("Vol. 2", "Set 2" — never "第2弾" or "第二弹"), character name(s) in their usual English spelling, and "by <maker>" when listings name the maker. Use the official English name when one exists; otherwise translate Chinese / Japanese / Korean titles to English. No Chinese, Japanese or Korean characters in this part. No shop names, prices, shipping notes, hashtags or 【】 tags.
Keep the whole name under 120 characters.`;

const MATCH_RULE = `First copy shop_title: the main title / logo text printed on the shop photo's item, exactly as printed (any language), or "" if none is readable. Write shop_item: the kind of item and its main artwork.
Then pick the candidate photo that shows the SAME product: same title / logo text and same artwork or character, any angle or background. Prefer a clean store or official photo of that one product. NOT a match: a different character, volume or colour; a different kind of item; a shelf or haul photo of many products; a video thumbnail, a person, a screenshot, or a photo where the title / artwork cannot be seen.
Copy chosen_title and write chosen_item the same way for the photo you pick, then image_index = its number, or -1 if none matches. When unsure, use -1.`;
const MATCH_FIELDS = {
  shop_title: { type: "STRING" }, shop_item: { type: "STRING" },
  chosen_title: { type: "STRING" }, chosen_item: { type: "STRING" }, image_index: { type: "INTEGER" },
};
const MATCH_ORDER = ["shop_title", "shop_item", "chosen_title", "chosen_item", "image_index"];

// The model's pick must share printed text with the shop photo ("HIGHLIGHT
// PICK" vs "シン・エヴァンゲリオン" → rejected). A side without readable text passes.
function titlesAgree(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const x = norm(a), y = norm(b);
  if (!x || !y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  for (let i = 0; i < short.length; i++) {
    // 2 characters for Chinese / Japanese / Korean, 4 for other scripts
    const n = /[぀-ヿ一-鿿가-힯]/.test(short[i]) ? 2 : 4;
    if (i + n <= short.length && long.includes(short.slice(i, i + n))) return true;
  }
  return short.length < 4 && long.includes(short);
}

function formatName(out: { series?: unknown; type_th?: unknown; product?: unknown }): string {
  const series = String(out.series ?? "").trim().replace(/^\[|\]$/g, "");
  let product = String(out.product ?? "").trim();
  // "[Highlight Pick] … Highlight Pick Collecting Card" → drop the repeat
  const at = series ? product.toLowerCase().indexOf(series.toLowerCase()) : -1;
  if (at >= 0) product = (product.slice(0, at) + product.slice(at + series.length)).replace(/^[\s:–-]+/, "").trim();
  const parts = [series ? `[${series}]` : "", String(out.type_th ?? "").trim(), product];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 160);
}

// Gemini looks at the photo + search clues → clean name + best candidate photo
async function pickName(photo: Photo, clues: Clues) {
  const { guess, entities, titles, candidates } = clues;
  const prompt = `The FIRST image is a product photo from a Thai shop owner adding stock (mostly anime/game character goods: acrylic stands, keychains, badges, photo cards, figures, plush — but could be anything).
Google reverse image search found this:
- Best guess: "${guess || "none"}"
- Related labels: ${entities.join(", ") || "none"}
- Titles of pages showing the same image:
${titles.map((t) => "  • " + t).join("\n") || "  (none)"}

Name the product using the clues above together with what is printed on the item. If the clues disagree, prefer what several titles agree on.
${NAME_PARTS}`;
  const r = await gemini({
    contents: [{ parts: [{ inline_data: { mime_type: photo.mime, data: photo.b64 } }, { text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { series: { type: "STRING" }, type_th: { type: "STRING" }, product: { type: "STRING" } },
        required: ["series", "type_th", "product"],
        propertyOrdering: ["series", "type_th", "product"],
      },
    },
  });
  const body = await r.json().catch(() => ({}));
  // Surface Google's reason (bad model name, free-tier quota used up, key problem…)
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${body.error?.message ?? ""}`);
  return formatName(JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}"));
}

// Main product photo of a store page, via its og:image / twitter:image tag
async function pageImage(pageUrl: string): Promise<{ imageUrl: string; pageUrl: string }> {
  try {
    const r = await fetch(pageUrl, {
      headers: BROWSER,
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { imageUrl: "", pageUrl: "" };
    const html = (await r.text()).slice(0, 600_000);
    const tag = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/i);
    const content = tag && tag[0].match(/content=["']([^"']+)["']/i);
    const img = content ? new URL(content[1].replace(/&amp;/g, "&"), r.url || pageUrl).href : "";
    return { imageUrl: httpsOnly(img), pageUrl: r.url || pageUrl }; // r.url = page after redirects
  } catch {
    return { imageUrl: "", pageUrl: "" };
  }
}

// Gemini reads the photo and searches Google itself (also in the language
// printed on the package — Korean / Japanese goods sell mostly on local shops).
// Used without a Vision key, and as the photo fallback when reverse image
// search finds no matching store photo.
async function geminiSearch(photo: Photo, known = "") {
  const t0 = Date.now();
  const prompt = `This is a product photo from a Thai shop owner adding stock (mostly anime/game character goods: acrylic stands, keychains, badges, photo cards, figures, plush — but could be anything).
${known ? `It was identified as: "${known}".
` : ""}Read the packaging text, logos, character and series, then you MUST use Google Search (do not answer from memory) to find this exact product on store or maker pages. Search in the language printed on the package (Korean / Japanese / Chinese) as well as in English, and put the exact text printed on it, including small print, in your queries (e.g. the product line name + its Korean / Japanese title). Take the series from what the search results say, not from memory.
${NAME_PARTS}
Reply with one line of JSON only: {"series": "...", "type_th": "...", "product": "..."}`;
  const r = await gemini({
    contents: [{ parts: [{ inline_data: { mime_type: photo.mime, data: photo.b64 } }, { text: prompt }] }],
    tools: [{ google_search: {} }],
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${body.error?.message ?? ""}`);
  const cand = body.candidates?.[0] ?? {};
  const text = (cand.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  const json = text.match(/{[^{}]*"product"[^{}]*}/g);
  let name = "";
  try { name = json ? formatName(JSON.parse(json[json.length - 1])) : ""; } catch { /* malformed JSON → no name */ }
  // Sources Google Search returned (redirect links that land on the real page)
  console.log("gemini search", { ms: Date.now() - t0, queries: cand.groundingMetadata?.webSearchQueries ?? [], results: cand.groundingMetadata?.groundingChunks?.length ?? 0 });
  const sources: string[] = (cand.groundingMetadata?.groundingChunks ?? [])
    .map((c: { web?: { uri?: string } }) => c.web?.uri ?? "").filter(Boolean).slice(0, 6);
  return { name, sources };
}

// Main photo of each source page → Gemini keeps the one that shows this product
// The photo the function already downloaded: the app shows and uploads this
// copy, so a source site that blocks the shop network (or hotlinking) still works
const dataUrl = (p?: Photo) => (p ? `data:${p.mime};base64,${p.b64}` : "");

async function photoFromPages(photo: Photo, pages: string[]): Promise<{ imageUrl: string; pageUrl: string; imageData: string }> {
  const why: string[] = [];
  const hits = await Promise.all(pages.map(async (p): Promise<Candidate | null> => {
    const h = await pageImage(p);
    const img = h.imageUrl ? await fetchImage(h.imageUrl, why) : null; // skip logos / blocked images
    if (!h.imageUrl) why.push(p.slice(0, 60) + " no page photo");
    return img ? { title: "", pageUrl: h.pageUrl, imageUrl: h.imageUrl, photo: img } : null;
  }));
  const cands = hits.filter((c): c is Candidate => !!c);
  const i = cands.length ? await matchImage(photo, cands) : -1;
  console.log("search", { pages: pages.length, withPhoto: cands.length, picked: i, page: cands[i]?.pageUrl ?? "", failed: why.slice(0, 6) });
  return cands[i]
    ? { imageUrl: cands[i].imageUrl, pageUrl: cands[i].pageUrl, imageData: dataUrl(cands[i].photo) }
    : { imageUrl: "", pageUrl: "", imageData: "" };
}

// Gemini compares the shop photo with candidate photos → index or -1
async function matchImage(photo: Photo, cands: Candidate[]): Promise<number> {
  const prompt = `The FIRST image is a shop photo of a product. The next ${cands.length} images are candidate store photos (numbered from 0).
${MATCH_RULE}`;
  const payload = {
    contents: [{ parts: [
      { inline_data: { mime_type: photo.mime, data: photo.b64 } },
      ...cands.map((c) => ({ inline_data: { mime_type: c.photo!.mime, data: c.photo!.b64 } })),
      { text: prompt },
    ] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties: MATCH_FIELDS, required: MATCH_ORDER, propertyOrdering: MATCH_ORDER },
    },
  };
  // No waiting on Flash (5 / min): when it is busy, Flash-Lite checks instead
  let r = await gemini(payload, MATCH_MODEL, false);
  if (!r.ok && MATCH_MODEL !== GEMINI_MODEL) r = await gemini(payload); // stronger model unavailable / out of quota
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return -1; // the name is already found; a missing photo is not an error
  let out: Record<string, unknown> = {};
  try { out = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}"); } catch { return -1; }
  const i = Number(out.image_index);
  const shopTitle = String(out.shop_title ?? "");
  const agree = titlesAgree(shopTitle, String(out.chosen_title ?? ""));
  console.log("match", { picked: i, shop: shopTitle, chosen: out.chosen_title, agree });
  if (!cands[i] || !agree) return -1;
  // The model can simply echo the shop title for the photo it likes, so read
  // the picked photo on its own, without telling it what we hope to see
  const seen = await readPhoto(cands[i].photo!);
  const ok = seen.products <= 1 && titlesAgree(shopTitle, seen.title);
  console.log("verify", { ...seen, ok });
  return ok ? i : -1;
}

// What a single photo shows: its printed title and how many different products
async function readPhoto(p: Photo): Promise<{ title: string; products: number }> {
  const r = await gemini({
    contents: [{ parts: [
      { inline_data: { mime_type: p.mime, data: p.b64 } },
      { text: `title = the main title / logo text printed on the product in this photo, copied exactly as printed (any language), or "" if none is readable.
products = how many DIFFERENT products are visible (a shelf, haul or collection photo has several; the same item from several sides counts as 1).` },
    ] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, products: { type: "INTEGER" } },
        required: ["title", "products"],
        propertyOrdering: ["title", "products"],
      },
    },
  });
  const body = await r.json().catch(() => ({}));
  // Cannot check → treat as not verified
  if (!r.ok) return { title: "?", products: 99 };
  try {
    const out = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
    return { title: String(out.title ?? ""), products: Number(out.products) || 1 };
  } catch { return { title: "?", products: 99 }; }
}

// One variant of a known product (a card in a set, a colour…): return only
// what tells it apart, e.g. "Zhenya" — the product name is already set.
async function variantName(photo: Photo, product: string): Promise<string> {
  const prompt = `This photo shows ONE variant of the product "${product.slice(0, 200) || "unknown"}" (mostly anime/game character goods sold in Thailand).
Name only what makes this variant different from the others in the same product: the character name(s) in their usual English spelling, or the colour / design / version (e.g. "Zhenya", "Kwon Taekjoo", "Red", "Secret ver."). Search Google if you need to identify a character.
Do not repeat the product name. Under 40 characters.
Reply with one line of JSON only: {"variant": "..."}`;
  const r = await gemini({
    contents: [{ parts: [{ inline_data: { mime_type: photo.mime, data: photo.b64 } }, { text: prompt }] }],
    tools: [{ google_search: {} }],
  });
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

  const started = Date.now();
  try {
    if (input.variant) {
      const name = await variantName(photo, String(input.product || ""));
      if (!name) return reply({ error: "ระบุตัวเลือกไม่ได้ ลองถ่ายให้ชัดขึ้น" });
      return reply({ name, imageUrl: "", pageUrl: "" });
    }
    if (!VISION_KEY) {
      const g = await geminiSearch(photo);
      if (!g.name) return reply({ error: "ระบุสินค้าไม่ได้ ลองถ่ายให้เห็นแพ็กเกจชัดขึ้น" });
      return reply({ name: g.name, ...(await within(started + 30_000 - Date.now(), photoFromPages(photo, g.sources), NO_PHOTO)) });
    }
    const clues = await webDetect(photo);
    // No silent fallback to a raw page title — the first match can be an
    // unrelated blog/Pinterest page. Gemini errors reach the admin as a toast.
    const ms: Record<string, number> = { vision: Date.now() - started };
    // No pages (common for Korean / Japanese goods; Cloud Vision's index is much
    // smaller than Google Lens) → the Google search is slow, so start it now,
    // next to the naming and photo check instead of after them
    const searching = clues.titles.length ? null : geminiSearch(photo).catch(() => null);
    // Naming and the photo check do not depend on each other: run them together
    const [guess, index] = await Promise.all([
      pickName(photo, clues),
      clues.candidates.length ? matchImage(photo, clues.candidates) : Promise.resolve(-1),
    ]);
    ms.nameAndCheck = Date.now() - started;
    const pick = clues.candidates[index];
    // Fast path: a checked store photo from reverse search → answer now
    if (guess && pick) {
      console.log("timing", ms);
      return reply({ name: guess, imageUrl: pick.imageUrl, pageUrl: pick.pageUrl, imageData: dataUrl(pick.photo) });
    }
    // ponytail: 30 s for the slow route; past that the admin gets the name and keeps their own photo
    const g = await within(started + 30_000 - Date.now(), searching ?? geminiSearch(photo, guess).catch(() => null), null);
    ms.search = Date.now() - started;
    // A name that came with real search results beats a guess when reverse search found no pages
    const name = searching && g?.sources.length && g.name ? g.name : guess;
    if (!name) return reply({ error: "ระบุสินค้าไม่ได้ ลองถ่ายให้เห็นแพ็กเกจชัดขึ้น" });
    const found = g ? await within(started + 30_000 - Date.now(), photoFromPages(photo, g.sources), NO_PHOTO) : NO_PHOTO;
    ms.total = Date.now() - started;
    console.log("timing", ms);
    return reply({ name, ...found });
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/Gemini 429/.test(msg)) return reply({ error: "AI ใช้เกินโควตาฟรีของ Gemini — รอ 1 นาทีแล้วลองใหม่ (ถ้ายังไม่ได้ แปลว่าครบโควตาวันนี้แล้ว)" });
    return reply({ error: "ค้นหาไม่สำเร็จ: " + msg });
  }
});
