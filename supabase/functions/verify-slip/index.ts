// verify-slip — checks a customer's bank slip with SlipOK (https://slipok.com/api-documentation/)
// before the status page may send it. The browser reads the slip's QR and sends
// the QR text here; SlipOK asks the bank and returns the real amount, date and
// receiver. With log: true SlipOK also refuses a slip not paid to the account
// registered for the branch (1014) and remembers slips it has seen (1012).
// The result is saved in public.slip_checks under the bank reference;
// customer_submit_payment only accepts a slip saved there that covers what is owed.
//
// Secrets (supabase secrets set …):
//   SLIPOK_API_KEY     the API key from the SlipOK LINE dashboard
//   SLIPOK_BRANCH_ID   the branch id that goes in the API address
import { createClient } from "npm:@supabase/supabase-js@2";

const API_KEY = Deno.env.get("SLIPOK_API_KEY") ?? "";
const BRANCH = Deno.env.get("SLIPOK_BRANCH_ID") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
// code: "slip" = this slip is not acceptable; "service" = the check itself could not run
// (the status page then lets the database decide, which refuses it while the check is on)
const fail = (message: string, code = "slip") => reply({ ok: false, message, code });

// SlipOK error codes the customer can do something about
const SLIP_ERRORS: Record<number, string> = {
  1000: "QR บนสลิปไม่ถูกต้อง กรุณาใช้รูปสลิปจากแอปธนาคาร",
  1006: "QR บนสลิปไม่ถูกต้อง กรุณาใช้รูปสลิปจากแอปธนาคาร",
  1007: "ไม่พบ QR บนสลิป กรุณาใช้รูปสลิปจากแอปธนาคาร",
  1008: "QR นี้ไม่ใช่ QR สำหรับตรวจสลิป กรุณาใช้รูปสลิปจากแอปธนาคาร",
  1010: "ธนาคารยังไม่ยืนยันรายการนี้ กรุณารอสักครู่แล้วส่งใหม่",
  1011: "ตรวจสอบสลิปนี้กับธนาคารไม่พบ กรุณาใช้สลิปจริงจากแอปธนาคาร",
  1014: "สลิปนี้ไม่ได้โอนเข้าบัญชีของร้าน",
};

// The bank reference inside a Thai slip QR: TLV, tag 00 → sub-tag 02 (same as the status page)
function slipRef(payload: string): string {
  const tlv = (s: string) => {
    const out: Record<string, string> = {};
    for (let i = 0; i + 4 <= s.length;) {
      const len = parseInt(s.substr(i + 2, 2), 10);
      if (isNaN(len)) break;
      out[s.substr(i, 2)] = s.substr(i + 4, len); i += 4 + len;
    }
    return out;
  };
  const ref = (tlv(payload)["00"] ? tlv(tlv(payload)["00"])["02"] ?? "" : "").trim();
  return /^[A-Za-z0-9]{8,64}$/.test(ref) ? ref : "";
}

type Party = { displayName?: string; name?: string; account?: { value?: string }; proxy?: { value?: string } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method");
  if (!API_KEY || !BRANCH) return fail("ร้านยังไม่ได้ตั้งค่าระบบตรวจสลิป กรุณาติดต่อร้าน", "service");

  let payload = "";
  try { payload = String((await req.json()).payload ?? "").trim(); } catch { /* empty body */ }
  if (!/^[\x21-\x7e]{8,256}$/.test(payload)) return fail(SLIP_ERRORS[1000]);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Checked before (the same slip sent again, e.g. to fix the address): answer from
  // what was saved — no new SlipOK call, no quota used. The database still decides
  // whether this slip may go to this order.
  const qrRef = slipRef(payload);
  const cols = "bank_ref, amount, paid_at, sender, receiver_ok";
  let prev: { data: any } = qrRef ? await db.from("slip_checks").select(cols).eq("bank_ref", qrRef).maybeSingle() : { data: null };
  if (!prev.data) prev = await db.from("slip_checks").select(cols).eq("payload", payload).limit(1).maybeSingle();
  if (prev.data && prev.data.receiver_ok) {
    const p = prev.data;
    return reply({ ok: true, ref: p.bank_ref, amount: Number(p.amount), date: new Date(p.paid_at).toISOString(), sender: p.sender || "", cached: true });
  }

  let j: Record<string, any>;
  try {
    const r = await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(BRANCH)}`, {
      method: "POST",
      headers: { "x-authorization": API_KEY, "Content-Type": "application/json" },
      // log: SlipOK checks the receiver is the branch's account and catches slips used twice
      body: JSON.stringify({ data: payload, log: true }),
      signal: AbortSignal.timeout(20_000),
    });
    j = await r.json();
  } catch {
    return fail("ตรวจสลิปไม่สำเร็จ (เชื่อมต่อไม่ได้) กรุณาลองใหม่อีกครั้ง", "service");
  }

  const code = Number(j?.code ?? 0);
  // 1012: SlipOK has seen this slip before. It may still be this customer's first send
  // here (or a resend to fix the address); the database decides, it knows every slip sent.
  const s = j?.data && typeof j.data === "object" ? j.data : null;
  const usable = j?.success === true || (code === 1012 && s?.transRef);
  if (!usable) {
    console.error("slipok", code, j?.message);
    if (code === 1012) return fail("สลิปนี้เคยใช้แล้ว", "service");
    if (SLIP_ERRORS[code]) return fail(SLIP_ERRORS[code]);
    // SlipOK's number (1001 branch, 1002 key, 1003/1004 package) helps the shop fix the setup
    return reply({ ok: false, code: "service", slipok: code || null, message: "ตรวจสลิปไม่สำเร็จ กรุณาลองใหม่ หรือติดต่อร้าน" });
  }

  const ref = String(s.transRef ?? "").trim();
  const amount = Number(s.amount);
  // transTimestamp is ISO (UTC); older answers only have transDate "yyyyMMdd" + transTime "HH:mm:ss" (Thai time)
  let at = new Date(String(s.transTimestamp ?? ""));
  if (isNaN(at.getTime()) && /^\d{8}$/.test(String(s.transDate)) && /^\d{2}:\d{2}:\d{2}$/.test(String(s.transTime))) {
    const d = String(s.transDate);
    at = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${s.transTime}+07:00`);
  }
  if (!/^[A-Za-z0-9]{8,64}$/.test(ref) || !(amount > 0) || isNaN(at.getTime())) {
    return fail("อ่านข้อมูลสลิปจากธนาคารไม่ครบ กรุณาติดต่อร้าน", "service");
  }
  const receiver: Party = s.receiver ?? {}, sender: Party = s.sender ?? {};
  const rName = receiver.displayName || receiver.name || "";
  const rAcc = receiver.account?.value || receiver.proxy?.value || "";
  const sName = sender.displayName || sender.name || "";

  const { error } = await db.from("slip_checks").upsert({
    bank_ref: ref, payload, amount, paid_at: at.toISOString(),
    receiver_ok: true, // with log: true SlipOK answers 1014 when it is not the shop's account
    receiver: (rName + (rAcc ? " · " + rAcc : "")).slice(0, 300), sender: sName.slice(0, 200),
    checked_at: new Date().toISOString(),
  });
  if (error) {
    console.error("slip_checks", error.message);
    return fail("บันทึกผลตรวจสลิปไม่สำเร็จ กรุณาลองใหม่", "service");
  }
  return reply({ ok: true, ref, amount, date: at.toISOString(), sender: sName });
});
