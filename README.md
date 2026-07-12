# Order Hub — Web Version (Supabase)

แปลงมาจาก Google Apps Script + Google Sheets เดิม โดย **UI และฟังก์ชันทั้งหมดเหมือนเดิม**
แต่เก็บข้อมูลใน Supabase (Postgres) แทน Google Sheets

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ (เทียบกับของเดิม) |
|---|---|
| `index.html` + `js/index.js` | หน้าลูกค้า Hub + ฟอร์มสั่งซื้อ (เดิม: Index.html) |
| `admin-login.html` | หน้า Login แอดมิน (เดิม: AdminLogin.html) |
| `admin.html` + `js/admin.js` | แผงแอดมิน (เดิม: Admin.html + AdminJS) |
| `pos.html` + `js/pos.js` | โหมด POS + สแกนบาร์โค้ด (เดิม: POS.html) |
| `js/api.js` | **หัวใจของระบบ** — จำลอง `google.script.run` และย้ายทุกฟังก์ชันจาก code.gs ไปใช้ Supabase |
| `js/config.js` | ⚙️ ใส่ค่า Supabase URL + Key ที่นี่ |
| `supabase/schema.sql` | สร้างตาราง + สิทธิ์ + ฟังก์ชันส่งออเดอร์ (รันครั้งเดียว) |

## วิธีติดตั้ง (ประมาณ 10 นาที)

### 1. สร้างโปรเจกต์ Supabase
1. ไปที่ https://supabase.com → **New project** (ฟรี)
2. ตั้งชื่อ + รหัสผ่านฐานข้อมูล แล้วรอสร้างเสร็จ

### 2. สร้างตาราง
1. ในแดชบอร์ด Supabase ไปที่ **SQL Editor**
2. คัดลอกเนื้อหาไฟล์ `supabase/schema.sql` ทั้งหมด วางแล้วกด **Run**

### 3. สร้างบัญชีแอดมิน
1. ไปที่ **Authentication → Users → Add user → Create new user**
2. ใส่อีเมล (เช่น `ongkub001@gmail.com`) + รหัสผ่าน
   - ติ๊ก **Auto Confirm User** ด้วย
3. ทำซ้ำสำหรับแอดมินทุกคน (แทนที่ Whitelist เดิม)

> **อยากล็อกอินด้วยชื่อผู้ใช้แทนอีเมล?** สร้าง user ด้วยอีเมลปลอมรูปแบบ
> `ชื่อผู้ใช้@orderhub.local` เช่น `admin@orderhub.local` — แล้วหน้า Login
> จะพิมพ์แค่ `admin` ได้เลย (โดเมนแก้ได้ที่ `ADMIN_USERNAME_DOMAIN` ใน `js/config.js`)

### 4. ใส่ค่าเชื่อมต่อ
1. **Project URL:** ไปที่ **Settings → General** (หรือกดปุ่ม **Connect** ด้านบน) แล้วคัดลอก URL เช่น `https://xxxx.supabase.co`
2. **API Key:** ไปที่ **Settings → API Keys**
   - โปรเจกต์ใหม่: คัดลอก **Publishable key** (`sb_publishable_...`)
   - โปรเจกต์เก่า: ใช้แท็บ Legacy แล้วคัดลอก **anon** key (`eyJhbGci...`)
   - ⚠️ ห้ามใช้ `sb_secret_...` / `service_role` key เด็ดขาด
3. เปิดไฟล์ `js/config.js` แล้วใส่ค่าทั้งสอง:
   ```js
   window.SUPABASE_URL      = 'https://xxxx.supabase.co';
   window.SUPABASE_ANON_KEY = 'sb_publishable_...';
   ```

### 5. เปิดใช้งาน
เว็บนี้เป็น static site ล้วน ๆ — โฮสต์ที่ไหนก็ได้:
- **ทดลองในเครื่อง:** เปิด terminal ในโฟลเดอร์ `web` แล้วรัน
  `python -m http.server 8000` (หรือ `npx serve`) → เปิด http://localhost:8000
- **ใช้งานจริง (ฟรี):** ลากโฟลเดอร์ `web` ขึ้น [Netlify Drop](https://app.netlify.com/drop)
  หรือ Vercel / GitHub Pages / Cloudflare Pages

หน้าเว็บ:
- `index.html` — หน้าสั่งซื้อของลูกค้า
- `admin-login.html` — เข้าระบบแอดมิน (URL เดิมแบบ `?page=admin` ก็ยังใช้ได้)
- `pos.html` — เปิดจากปุ่ม "เปิดโหมด POS" ในแอดมิน

## สิ่งที่เปลี่ยนจากเวอร์ชัน Apps Script

| เรื่อง | เดิม | ตอนนี้ |
|---|---|---|
| ฐานข้อมูล | Google Sheets | Supabase (Postgres + Row Level Security) |
| ล็อกอินแอดมิน | รหัสผ่านใน code.gs / ชีต Whitelist | **Supabase Auth** (เพิ่ม/ลบแอดมินในแดชบอร์ด) |
| ตัดสต็อกตอนสั่งซื้อ | LockService + เขียนชีต | ฟังก์ชัน `submit_order` ใน Postgres (atomic, กันสต็อกติดลบ) |
| อัปโหลดรูป | ผ่าน Apps Script → Cloudinary | เบราว์เซอร์อัปโหลดตรงเข้า Cloudinary (cloud/preset เดิม) |
| "เชื่อมชีต" ในแอดมิน | ผูก Spreadsheet ด้วย URL | ❌ ใช้ไม่ได้แล้ว — ใช้ปุ่ม "✨ สร้างใหม่" แทน |
| แจ้งเตือนสั่งของ (อีเมล) | MailApp ส่งอีเมลอัตโนมัติ | เปิดแอปอีเมล (mailto) พร้อมเนื้อหาสรุปให้ กด Send เอง |
| เพิ่มลงปฏิทิน | CalendarApp สร้าง event | เปิดหน้า Google Calendar พร้อมกรอก event ให้ กด Save เอง |
| ชีต "Summary Order" | สูตรในชีต | คำนวณสรุปจากตาราง orders อัตโนมัติ |
| ลบรายการสั่งซื้อ | ชีตยังอยู่ แค่หลุดจาก Hub | ⚠️ ลบสินค้า+ออเดอร์ในรายการนั้นถาวร |
| รายชื่ออีเมลแจ้งเตือน | ชีต Whitelist | ตาราง `notify_emails` (แก้ได้ใน Supabase → Table Editor) |

> ถ้าอยากให้ระบบ**ส่งอีเมลอัตโนมัติจริง ๆ** ต้องเพิ่ม Supabase Edge Function + บริการอย่าง Resend — แจ้งได้เลยถ้าต้องการ

## หมายเหตุความปลอดภัย
- `anon key` ใส่ในหน้าเว็บได้ ปลอดภัยเพราะสิทธิ์ถูกคุมด้วย Row Level Security:
  ลูกค้า (ไม่ล็อกอิน) อ่านรายการ/สินค้า + ส่งออเดอร์ได้เท่านั้น — แก้ไขข้อมูลต้องล็อกอินแอดมิน
- อย่าเอา `service_role` key มาใส่ใน config.js เด็ดขาด

## Security migration (required after this update)

Run `supabase/schema.sql` again in the Supabase SQL Editor. The schema now uses
an explicit `admin_users` allowlist instead of treating every authenticated user
as an administrator. The configured username `admin` maps to the seeded account
`admin@kagashop.admin`.

If your administrator signs in with a different email, add it from the SQL
Editor before signing in:

```sql
insert into public.admin_users(email)
values ('your-admin@example.com')
on conflict do nothing;
```

Keep public email sign-up disabled unless the application needs customer
accounts. Anonymous order submission is validated in the database, but a
production deployment should still place CAPTCHA/rate limiting in front of the
public `submit_order` call.

For local static checks (Node.js required):

```bash
npm run check
```
