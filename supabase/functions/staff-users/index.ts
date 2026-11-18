// staff-users — admin → ทีมงาน: create staff logins (e.g. staff@kagashop.admin), set what each
// may do ("admin" = everything, "pos" = POS only, for the rounds ticked), reset a password,
// remove a login.
// Only admins can call it (the same is_admin() check the web app uses).
//
// Uses the project's own service key (SUPABASE_SERVICE_ROLE_KEY, provided to every function
// by Supabase) to create and change logins; nothing is sent anywhere else.
// Needs supabase/migrations/2026-11-22-staff-roles.sql to have been run.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" } });
const fail = (message: string) => reply({ ok: false, message });

const ROLES = ["admin", "pos"];
const cleanEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();
const okEmail = (e: string) => /^[a-z0-9._%+-]{2,40}@[a-z0-9.-]+\.[a-z]{2,}$/.test(e);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin } = await caller.rpc("is_admin");
  if (!isAdmin) return fail("สำหรับแอดมินเท่านั้น");
  const { data: me } = await caller.auth.getUser();
  const myEmail = cleanEmail(me?.user?.email);

  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!service) return fail("ยังไม่มี SUPABASE_SERVICE_ROLE_KEY ในฟังก์ชัน");
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty body */ }
  const action = String(b.action ?? "list");
  const email = cleanEmail(b.email);
  const role = String(b.role ?? "");
  const password = String(b.password ?? "");
  const uuid = /^[0-9a-f-]{36}$/i;
  const listIds = (Array.isArray(b.listIds) ? b.listIds : []).map(String).filter((id) => uuid.test(id)).slice(0, 500);

  // Replace the rounds a POS login may use
  async function setRounds(e: string) {
    const d = await admin.from("staff_rounds").delete().eq("email", e);
    if (d.error) return d.error.message;
    if (!listIds.length) return "";
    const r = await admin.from("staff_rounds").insert(listIds.map((list_id) => ({ email: e, list_id })));
    return r.error ? r.error.message : "";
  }

  // The login with this email (Auth has no lookup by email, so page through)
  async function findUser(e: string) {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const hit = data.users.find((u) => cleanEmail(u.email) === e);
      if (hit) return hit;
      if (data.users.length < 200) return null;
    }
    return null;
  }
  // The built-in admins (admin_users) are fixed: not changed or removed from here
  async function isOwner(e: string) {
    const { data } = await admin.from("admin_users").select("email").eq("email", e).maybeSingle();
    return !!data;
  }

  try {
    if (action === "list") {
      const [roles, owners, rounds] = await Promise.all([
        admin.from("staff_roles").select("email,role,created_at").order("created_at"),
        admin.from("admin_users").select("email"),
        admin.from("staff_rounds").select("email,list_id"),
      ]);
      if (roles.error) {
        if (/staff_roles/.test(roles.error.message)) return fail("ยังไม่ได้รันไฟล์ supabase/migrations/2026-11-22-staff-roles.sql ใน SQL Editor");
        return fail(roles.error.message);
      }
      return reply({
        ok: true, me: myEmail,
        owners: (owners.data ?? []).map((o) => o.email),
        staff: (roles.data ?? []).map((s) => ({
          ...s, listIds: (rounds.data ?? []).filter((r) => r.email === s.email).map((r) => r.list_id),
        })),
      });
    }

    if (!okEmail(email)) return fail("ชื่อผู้ใช้ไม่ถูกต้อง (ใช้ a-z 0-9 . _ -)");
    if (await isOwner(email)) return fail("บัญชีแอดมินหลักแก้จากหน้านี้ไม่ได้");

    if (action === "create") {
      if (!ROLES.includes(role)) return fail("เลือกสิทธิ์ก่อน");
      if (password.length < 8) return fail("รหัสผ่านต้องยาวอย่างน้อย 8 ตัว");
      const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (made.error) {
        if (/already|registered|exists/i.test(made.error.message)) return fail("มีชื่อผู้ใช้นี้แล้ว ใช้ปุ่มเปลี่ยนรหัสผ่านหรือเปลี่ยนสิทธิ์แทน");
        return fail(made.error.message);
      }
      const r = await admin.from("staff_roles").upsert({ email, role });
      if (r.error) return fail(r.error.message);
      if (role === "pos") { const bad = await setRounds(email); if (bad) return fail(bad); }
      return reply({ ok: true });
    }

    if (action === "rounds") {
      const { data: row } = await admin.from("staff_roles").select("role").eq("email", email).maybeSingle();
      if (!row) return fail("ไม่พบบัญชีนี้ในทีม");
      const bad = await setRounds(email);
      if (bad) return fail(bad);
      return reply({ ok: true });
    }

    if (action === "role") {
      if (!ROLES.includes(role)) return fail("เลือกสิทธิ์ก่อน");
      if (email === myEmail && role !== "admin") return fail("เปลี่ยนสิทธิ์ของตัวเองไม่ได้");
      const r = await admin.from("staff_roles").upsert({ email, role });
      if (r.error) return fail(r.error.message);
      return reply({ ok: true });
    }

    if (action === "password") {
      if (password.length < 8) return fail("รหัสผ่านต้องยาวอย่างน้อย 8 ตัว");
      const u = await findUser(email);
      if (!u) return fail("ไม่พบบัญชีนี้");
      const r = await admin.auth.admin.updateUserById(u.id, { password });
      if (r.error) return fail(r.error.message);
      return reply({ ok: true });
    }

    if (action === "remove") {
      if (email === myEmail) return fail("ลบบัญชีของตัวเองไม่ได้");
      const r = await admin.from("staff_roles").delete().eq("email", email);
      if (r.error) return fail(r.error.message);
      const u = await findUser(email);
      if (u) {
        const d = await admin.auth.admin.deleteUser(u.id);
        if (d.error) return fail(d.error.message);
      }
      return reply({ ok: true });
    }

    return fail("ไม่รู้จักคำสั่งนี้");
  } catch (e) {
    console.error("staff-users", e);
    return fail("เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
  }
});
