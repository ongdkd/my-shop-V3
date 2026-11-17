// faye-chat — turns what the admin typed to Faye into ONE action from a fixed list.
// Gemini only sees the typed sentence (plus the page names and this page's tips);
// the admin page then looks the data up itself, so no shop data is sent to the AI.
// One Gemini call per question.
//
// Secrets: GEMINI_API_KEY (the same key identify-product uses).
// Optional: FAYE_MODEL (default: GEMINI_MODEL, then gemini-flash-lite-latest).
import { createClient } from "npm:@supabase/supabase-js@2";

const KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL = Deno.env.get("FAYE_MODEL") || Deno.env.get("GEMINI_MODEL") || "gemini-flash-lite-latest";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" } });
const fail = (message: string) => reply({ ok: false, message });

// What Faye can do. The page (js/admin.js fayeRun) runs these; anything else is ignored there.
const ACTIONS = ["answer", "ship_status", "sales", "buy_list", "low_stock", "stock_of", "waiting", "goto", "find_orders", "add_stock"];

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!KEY) return fail("ยังไม่ได้ตั้งค่า GEMINI_API_KEY");

  // Admins only — the same is_admin() check the web app uses
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) return fail("สำหรับแอดมินเท่านั้น");

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty body */ }
  const text = clip(b.text, 300);
  if (!text) return fail("พิมพ์คำถามก่อนนะครับ");
  const panels = (Array.isArray(b.panels) ? b.panels : []).slice(0, 20)
    .map((p) => ({ id: clip(p?.id, 20), label: clip(p?.label, 40) })).filter((p) => /^[a-z]+$/.test(p.id));
  const tips = (Array.isArray(b.tips) ? b.tips : []).slice(0, 12).map((t) => clip(t?.[0], 80) + " → " + clip(t?.[1], 300));

  const now = new Date();
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
  const weekday = now.toLocaleDateString("en-US", { timeZone: "Asia/Bangkok", weekday: "long" });

  const system = `คุณคือ Faye ผู้ช่วยหลังร้านของร้านพรีออเดอร์ พูดไทยสั้น ๆ
บุคลิก: เด็กผู้ชายพิกเซลผมส้ม แว่นดำคาดหัว นิสัยเท่ ๆ กวน ๆ นิดหน่อย ขี้แซวแต่ใจดีและใส่ใจเจ้าของร้าน
- เรียกเจ้าของร้านว่า บอส แทนตัวเองว่า ผม ลงท้าย ครับ หรือ นะ ได้
- ทำเป็นไม่ตื่นเต้น แต่จริง ๆ ภูมิใจเวลาร้านขายดี แซวเบา ๆ ได้ แต่ไม่หยาบ ไม่ประชด ไม่ว่าลูกค้า
- เรื่องเงิน ยอด สถานะ ให้ชัดเจนก่อน แล้วค่อยแซวสั้น ๆ ท้ายประโยคถ้าเหมาะ
วันนี้คือ ${today} (${weekday}) เวลาไทย
เลือก do หนึ่งอย่างจากรายการนี้เท่านั้น:
- ship_status: ถามว่าของ/ออเดอร์ของลูกค้าคนหนึ่งถึงไหน ส่งหรือยัง เลขพัสดุ → ใส่ customer (ชื่อที่พิมพ์มา ไม่ต้องแก้)
- sales: ถามยอดขาย → ใส่ from และ to เป็น YYYY-MM-DD (วันนี้, เมื่อวาน, 7 วัน, เดือนนี้ ฯลฯ คิดจากวันนี้)
- buy_list: ถามว่ารอบ/รายการ/ลิสต์หนึ่งต้องสั่งซื้อของอะไรบ้าง กี่ชิ้น ลูกค้าสั่งอะไรไปเท่าไร สรุปยอดตามสินค้าของรอบ → ใส่ item เป็นชื่อรอบตามที่พิมพ์ (ถ้าพูดว่า "รอบนี้" ให้เว้นว่าง)
- low_stock: ถามว่าของชิ้นไหนใกล้หมด/หมดแล้วในคลัง
- stock_of: ถามว่าในคลัง (ของที่มีอยู่บนชั้น) เหลือกี่ชิ้น เฉพาะคลังสินค้าเท่านั้น ไม่ใช่ยอดที่ลูกค้าสั่ง → ใส่ item
- waiting: ถามว่ามีออเดอร์รอจัดส่งเท่าไร/รอบไหนยังไม่ส่ง
- find_orders: ให้ค้นหรือเปิดออเดอร์/บิลของลูกค้าหรือสินค้า → ใส่ query
- add_stock: ให้เพิ่มสต็อกหรือเพิ่มสินค้าในคลัง → ใส่ item และ qty ถ้าบอกมา (ไม่บอกก็เว้นว่าง)
- goto: ให้ไปหน้าอื่น → ใส่ panel เป็น id ของหน้า: ${panels.map((p) => p.id + " = " + p.label).join(", ")}
- answer: ทักทาย ถามวิธีใช้ หรือเรื่องที่ทำไม่ได้ → ตอบใน say
กติกา:
- คุณไม่เห็นข้อมูลร้าน ห้ามแต่งตัวเลข ชื่อ หรือสถานะเอง หน้าเว็บจะหาข้อมูลจริงมาแสดงเอง
- คุณแก้ไขหรือลบข้อมูลไม่ได้ ถ้าถูกขอให้ทำ ใช้ answer แล้วบอกว่ายังทำไม่ได้ ให้กดทำเองในหน้านั้น
- คำถามเรื่องใครจ่ายแล้ว/ยังไม่จ่าย/สลิป: ใช้ goto ไปหน้าสลิป แล้วบอกใน say ว่าระบบเริ่มบันทึกการชำระเงินตั้งแต่ 13 พ.ย. 2026
- say: ประโยคสั้น ๆ หนึ่งประโยคบอกว่ากำลังทำอะไร (สำหรับ answer คือคำตอบเต็ม ไม่เกิน 3 ประโยค)
วิธีใช้ของหน้าที่เปิดอยู่ (ใช้ตอบคำถามวิธีใช้):
${tips.join("\n") || "-"}`;

  const prev = clip(b.prev, 300);
  const S = (description: string) => ({ type: "STRING", description });
  let r: Response;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: (prev ? `(คำถามก่อนหน้า: ${prev})\n` : "") + text }] }],
        generationConfig: {
          temperature: 0.2, maxOutputTokens: 400, responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              do: { type: "STRING", enum: ACTIONS },
              say: S("what Faye says, Thai"),
              customer: S("customer name as typed"), item: S("product name as typed"), query: S("search words"),
              qty: { type: "NUMBER" }, panel: S("page id"), from: S("YYYY-MM-DD"), to: S("YYYY-MM-DD"),
            },
            required: ["do", "say"],
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return fail("AI ไม่ตอบ ลองใหม่อีกครั้งนะครับ");
  }
  const body = await r.json().catch(() => ({}));
  if (r.status === 429) return fail("ตอนนี้ AI ใช้งานเต็มโควตา รอสักครู่แล้วลองใหม่นะครับ");
  if (!r.ok) { console.error("gemini", r.status, body?.error?.message); return fail(`AI ตอบไม่ได้ (${r.status})`); }

  let out: Record<string, unknown> = {};
  try { out = JSON.parse(body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? ""); } catch { /* not JSON */ }
  if (!ACTIONS.includes(String(out.do))) return fail("ผมไม่เข้าใจ ลองพิมพ์ใหม่อีกแบบนะครับ");
  return reply({
    ok: true, do: out.do, say: clip(out.say, 500),
    customer: clip(out.customer, 80), item: clip(out.item, 120), query: clip(out.query, 120),
    qty: Number(out.qty) > 0 ? Math.floor(Number(out.qty)) : 0,
    panel: clip(out.panel, 20), from: clip(out.from, 10), to: clip(out.to, 10),
  });
});
