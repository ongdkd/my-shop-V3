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
| `js/config.js` | ⚙️ ใส่ค่า Supabase URL/Key และ Google Sheets API key ที่นี่ |
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
| "เชื่อมชีต" ในแอดมิน | ผูก Spreadsheet ด้วย URL | ✅ นำเข้าข้อมูลเก่าจากแท็บ `Products` + `Orders` เข้า Supabase แบบครั้งเดียว |
| แจ้งเตือนสั่งของ (อีเมล) | MailApp ส่งอีเมลอัตโนมัติ | เปิดแอปอีเมล (mailto) พร้อมเนื้อหาสรุปให้ กด Send เอง |
| เพิ่มลงปฏิทิน | CalendarApp สร้าง event | เปิดหน้า Google Calendar พร้อมกรอก event ให้ กด Save เอง |
| ชีต "Summary Order" | สูตรในชีต | คำนวณสรุปจากตาราง orders อัตโนมัติ |
| คลังสินค้า → รายการสั่งซื้อ | คัดลอกแล้วแยกจากกัน | เชื่อมสินค้าที่นำเข้าและเลือกซิงก์ข้อมูลสินค้าได้ โดยสต็อกยังแยกกัน |
| ลบรายการสั่งซื้อ | ชีตยังอยู่ แค่หลุดจาก Hub | ⚠️ ลบสินค้า+ออเดอร์ในรายการนั้นถาวร |
| รายชื่ออีเมลแจ้งเตือน | ชีต Whitelist | ตาราง `notify_emails` (แก้ได้ใน Supabase → Table Editor) |

> ถ้าอยากให้ระบบ**ส่งอีเมลอัตโนมัติจริง ๆ** ต้องเพิ่ม Supabase Edge Function + บริการอย่าง Resend — แจ้งได้เลยถ้าต้องการ

## นำเข้ารายการเก่าจาก Google Sheets

### ตั้งค่า Google Sheets API (ครั้งเดียว)

1. เปิด [Google Cloud Console](https://console.cloud.google.com/) แล้วเลือกหรือสร้าง Project
2. ไปที่ **APIs & Services → Library** แล้วเปิดใช้งาน **Google Sheets API**
3. ไปที่ **APIs & Services → Credentials → Create credentials → API key**
4. ตั้ง **Application restrictions → Websites** และเพิ่ม URL เว็บจริง เช่น `https://your-domain.example/*` รวมถึง `http://localhost:8000/*` สำหรับทดสอบ
5. ตั้ง **API restrictions → Restrict key → Google Sheets API**
6. ใส่ key ใน `js/config.js`:

```js
window.GOOGLE_SHEETS_API_KEY = 'AIza...';
```

API key ฝั่งเบราว์เซอร์สามารถมองเห็นได้ตามปกติ จึงต้องจำกัดทั้งโดเมนและ API ตามข้อ 4–5

### วิธีนำเข้า

1. เปิด Spreadsheet เก่า แล้วตั้งค่า **แชร์ → ทุกคนที่มีลิงก์ → ผู้มีสิทธิ์ดู**
2. ตรวจสอบว่ามีแท็บชื่อ `Products` และ `Orders` (ตัวพิมพ์ตรงกัน)
3. ในหน้า Admin กด **สร้างรายการใหม่ → 📥 นำเข้าชีตเก่า**
4. วาง URL ของ Spreadsheet แล้วกด **นำเข้าข้อมูล** — `ชื่อรายการ` จะใช้ชื่อไฟล์ Spreadsheet อัตโนมัติ
5. ตรวจสอบจำนวนสินค้าและออเดอร์ที่นำเข้า ก่อนเปลี่ยนสถานะรายการจาก `Closed` เป็น `Open`

ระบบอ่านชื่อคอลัมน์ทั้งภาษาไทยและอังกฤษ ถ้าหัวคอลัมน์ไม่ตรง จะใช้ลำดับเดิมดังนี้:

- `Products`: รหัส, ชื่อ, รูป, ราคาเต็ม, มัดจำ, คงเหลือ, สถานะ, หยวน, ตัวเลือก
- `Orders`: วันเวลา, ลูกค้า, สินค้า, จำนวน, ประเภทชำระ, ราคา, รวม, หยวน, รวมหยวน, ราคาเต็ม, รวมราคาเต็ม, หมายเหตุ/เบอร์โทร

การนำเข้าเป็นการ **คัดลอก** ข้อมูลเข้า Supabase หากแถวใดไม่ถูกต้อง ระบบจะยกเลิกการนำเข้าทั้งรายการเพื่อไม่ให้เหลือข้อมูลบางส่วน

### อัปเดตสินค้าจากชีตภายหลัง (ซิงก์)

รายการที่นำเข้าจากชีตจะมีปุ่ม **🔄 ซิงก์สินค้าจากชีต** บนการ์ดในหน้าภาพรวม กดเมื่อไรก็ได้เพื่อดึงข้อมูลจากแท็บ `Products` ล่าสุด:

- สินค้าที่**รหัสตรงกัน** → อัปเดตชื่อ ราคา มัดจำ หยวน รูป ตัวเลือก และสถานะ
- สินค้า**ใหม่**ในชีต → เพิ่มเข้าเว็บ
- สินค้าที่**หายไป**จากชีต → ไม่ถูกลบ (ลบเองในหน้า Admin ถ้าต้องการ)
- **สต็อกคงเหลือ** จะไม่ถูกทับ เว้นแต่ติ๊ก "อัปเดตสต็อกจากชีตด้วย" — ระวังว่าจะทับยอดที่เว็บตัดไว้จากออเดอร์ออนไลน์

หมายเหตุ: ฟีเจอร์นี้ต้องรัน `supabase/schema.sql` เวอร์ชันล่าสุด (เพิ่มคอลัมน์ `source_spreadsheet_id`) และใช้ได้กับรายการที่นำเข้า**หลัง**อัปเดตนี้ — รายการที่นำเข้าไว้ก่อนหน้าไม่มีลิงก์ชีตบันทึกไว้ ให้ใส่ ID ของ Spreadsheet ในคอลัมน์ `source_spreadsheet_id` ผ่าน Supabase → Table Editor (หรือ ลบแล้วนำเข้าใหม่)

ถ้าพบข้อความ `Could not find the function public.import_legacy_order_list ... in the schema cache` ให้เปิด Supabase → **SQL Editor**, รันไฟล์ `supabase/schema.sql` เวอร์ชันล่าสุดทั้งหมด แล้วรันคำสั่งนี้อีกครั้ง:

```sql
notify pgrst, 'reload schema';
```

## เชื่อมสินค้าคลังกับรายการสั่งซื้อ

สินค้าที่กด **📤 นำสินค้าเข้า** จากหน้าคลังหลังอัปเดตนี้จะจำว่าสร้างมาจากสินค้าคลังตัวใด เมื่อแก้ไขสินค้าใน **คลังสินค้า** จะมีตัวเลือก:

> อัปเดตสินค้าที่นำเข้ารายการแล้วด้วย (X รายการ)

เมื่อติ๊ก ระบบจะอัปเดตชื่อ ราคา มัดจำ หยวน รูปภาพ สถานะ และตัวเลือกในทุกรายการที่เชื่อมอยู่ แต่จะ**ไม่เปลี่ยนจำนวนคงเหลือ** เพราะแต่ละรายการสั่งซื้อจัดการสต็อกของตัวเอง หากไม่ติ๊ก สามารถแก้รายละเอียดเฉพาะในคลังโดยไม่กระทบรายการที่เปิดขายอยู่ได้เหมือนเดิม

ตอนเลือกสินค้าชิ้นเดียวจากคลังเพื่อนำเข้า ระบบจะตั้งจำนวนเริ่มต้นเป็นสต็อกที่มีอยู่ทั้งหมดโดยอัตโนมัติ หากตั้งสต็อกเป็นไม่จำกัด (`∞`) จะเริ่มที่ `1` และยังปรับจำนวนด้วยปุ่ม `− / +` ได้ตามปกติ

ต้องรัน `supabase/schema.sql` เวอร์ชันล่าสุดก่อนใช้งาน ฟังก์ชัน migration จะเชื่อมสินค้าเดิมให้อัตโนมัติเฉพาะสินค้าชิ้นเดียวที่มีบาร์โค้ดไม่ว่างและตรงกับสินค้าคลังแบบไม่ซ้ำ ส่วนสินค้าเดิมที่มีตัวเลือกใช้รหัสหลักแบบสุ่ม จึงต้องนำเข้าใหม่เพื่อสร้างลิงก์ที่แน่นอน

## โหมด POS บันทึกการขายจริง

ปุ่ม **"ชำระเงินแล้ว — บันทึกการขาย"** ใน POS จะบันทึกออเดอร์เข้า Supabase (ลูกค้า = `หน้าร้าน (POS)`, หมายเหตุ = `POS`) และ**ตัดสต็อกทันที** แบบเดียวกับออเดอร์ออนไลน์ — ยอดขายหน้าร้านจึงรวมอยู่ในหน้า "คำสั่งซื้อ" และ "สรุปยอด" ด้วย

- ใช้ได้แม้รายการจะปิดรับออเดอร์ออนไลน์แล้ว (ขายหน้าร้านต่อได้)
- เครื่องสแกนบาร์โค้ด USB/Bluetooth ใช้ได้เลย: ยิงบาร์โค้ดลงช่องค้นหา (เครื่องจะพิมพ์รหัส + Enter ให้เอง) สินค้าจะเข้าตะกร้าทันที
- สินค้าที่มีตัวเลือกจะแสดงรูปของตัวเลือกที่เลือก และจำกัดจำนวนตามสต็อกของตัวเลือกนั้น (พร้อมตรวจสต็อกรวมของสินค้าด้วย)
- ⚠️ ฟีเจอร์นี้ต้องรัน `supabase/schema.sql` เวอร์ชันล่าสุด (เพิ่มฟังก์ชัน `submit_pos_sale`)

หลังอัปเดตฟีเจอร์รูป/สต็อกตัวเลือก ต้องรัน `supabase/schema.sql` เวอร์ชันล่าสุดเพื่อเพิ่ม `products.option_details` จากนั้นนำสินค้าที่มีตัวเลือกเดิมออกจากรายการและนำเข้าจากคลังใหม่อีกครั้ง เพราะข้อมูลเก่าเก็บไว้เฉพาะชื่อตัวเลือกและสต็อกรวม จึงไม่สามารถกู้จำนวนของแต่ละตัวเลือกย้อนหลังได้อย่างถูกต้อง

## สำรองข้อมูล (สำคัญ!)

Supabase แผนฟรีไม่มีระบบกู้ข้อมูลย้อนหลัง — ปุ่ม **💾 สำรองข้อมูล** ในหน้าภาพรวมจะดาวน์โหลด:
- `orderhub-backup-*.json` — ข้อมูลทุกตาราง (ใช้กู้คืนได้)
- `orderhub-orders-*.csv` — ออเดอร์ทั้งหมด เปิดใน Excel ได้ (รองรับภาษาไทย)

แนะนำให้กดสำรองเป็นประจำ โดยเฉพาะก่อนลบรายการหรือซิงก์ข้อมูลใหญ่ ๆ

### สำรองอัตโนมัติใน Supabase

รัน `supabase/migrations/2026-10-28-auto-backup.sql` ใน SQL Editor ครั้งเดียว (หรือ `schema.sql` ล่าสุด) ระบบจะเก็บสำเนาข้อมูลทุกตารางไว้ในตาราง `backups` ทุกคืน 03:00 (pg_cron) เก็บ 30 ครั้งล่าสุด ครั้งเก่ากว่านั้นถูกลบอัตโนมัติ

ปุ่ม **💾 สำรองข้อมูล** เปิดหน้าต่างที่:
- **สำรองตอนนี้** — เก็บสำเนาเพิ่มทันที (เช่น ก่อนลบรายการ)
- **⬇ JSON** — ดาวน์โหลดสำเนาแต่ละครั้ง (รูปแบบเดียวกับไฟล์ `orderhub-backup-*.json`)
- **ดาวน์โหลดข้อมูลล่าสุด** — ไฟล์ JSON + CSV แบบเดิม

⚠️ สำเนาใน Supabase ช่วยกรณีข้อมูลถูกลบ/แก้ผิด แต่ไม่ช่วยถ้าโปรเจกต์ Supabase หายทั้งโปรเจกต์ — ควรดาวน์โหลดเก็บไว้นอกระบบเป็นครั้งคราวด้วย

## โมเดลสต็อก: คลัง = ของที่ยังไม่ได้จัดสรร

การกด **📤 นำสินค้าเข้า** จะ**ตัดสต็อกคลังทันที** (จองให้รายการนั้น):
- สินค้าเดียว: นำเข้า N ชิ้น → คลังลด N (ระบบกันไม่ให้นำเข้าเกินคลัง)
- สินค้ามีตัวเลือก: จัดสรรสต็อกตัวเลือก**ทั้งหมด**เข้ารายการ (คลังตัวเลือกเป็น 0) โดยรายการเก็บทั้งสต็อกรวมและสต็อกแยกของแต่ละตัวเลือก
- ยอดขาย (เว็บ/POS) ตัดจากสต็อกของรายการเท่านั้น — คลังคือของที่ยังไม่ถูกจัดสรร

## กันออเดอร์ซ้ำ (checkout id)

ทุกการยืนยันออเดอร์ (เว็บลูกค้าและ POS) แนบรหัสเช็คเอาต์ไม่ซ้ำกัน — ถ้าเน็ตหลุดแล้วลูกค้ากดยืนยันซ้ำ ระบบจะรู้ว่าเป็นออเดอร์เดิมและไม่สร้างซ้ำ/ไม่ตัดสต็อกสองรอบ
⚠️ ต้องรัน `supabase/schema.sql` เวอร์ชันล่าสุด (เพิ่มตาราง `checkout_requests` + อัปเดตฟังก์ชัน) — ระหว่างที่ยังไม่รัน เว็บจะยังรับออเดอร์ได้ตามปกติ (แค่ยังไม่มีการกันซ้ำ)

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

## Free gifts by spend (ของแถมตามยอดซื้อ)

Each order list can give free gifts when one checkout reaches a total, e.g.
"¥188 → sticker, ¥288 → poster" or "฿500 → keyring". Set them in Admin →
ภาพรวม → ✎ on the list → "ของแถมตามยอดซื้อ":

- **Amount** in ¥ (compares the order's yuan value) or ฿ (its full-price value;
  deposit items count at full price).
- **Stock** per gift — leave blank for unlimited; it counts down per gift given.
- **Mode**: "ได้ทุกชิ้นที่ถึง" gives every gift reached; "ได้ 1 ชิ้นที่ดีที่สุด"
  gives only the lowest rule in the list that was reached (list small → big).

Customers see progress in the cart ("ซื้ออีก ¥38 …") and the gifts on the
summary and receipt. The database decides the gifts at checkout and records
each one as a ฿0 line "ของแถม: …" on the order, so they appear in the orders
screen for packing. Online orders only (not POS).

**Setup:** re-run `supabase/schema.sql` in the Supabase SQL Editor once (it is
safe to run again; it adds two columns and updates `submit_order`). Until then
the shop works as before and the admin editor shows a reminder.

Test the gift logic on a local Postgres: `npm install` then `npm run test:db`.

## AI product lookup (optional)

The admin "✨ AI ตั้งชื่อ" buttons call the Supabase Edge Function
`supabase/functions/identify-product`. Google Cloud Vision (Web Detection)
finds store pages showing the same product, then Gemini Flash-Lite writes a
clean name and picks the best store photo. Both keys stay in Supabase; the
browser never sees them. Without this function the rest of the admin works as
before and the AI buttons show an error toast.

Keys:
- `GEMINI_API_KEY` (required): https://aistudio.google.com/apikey. Create it in
  a project **without** billing to stay on the free tier.
- `GOOGLE_VISION_API_KEY` (optional, better photos): Google Cloud console →
  enable *Cloud Vision API* → Credentials → API key (Application restrictions:
  None; API restriction: Cloud Vision API). Billing must be on; the first 1,000
  images/month are free. Without it, Gemini searches Google itself and the
  photo comes from a page it found.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase secrets set GOOGLE_VISION_API_KEY=<vision key> GEMINI_API_KEY=<gemini key>
npx supabase functions deploy identify-product
```

Only signed-in admins (`is_admin()`) can call it. If Gemini fails (e.g. wrong
model name or free-tier limit), the admin sees Google's error message instead
of a name. Set the optional `GEMINI_MODEL` secret to pin a specific model.

## iShip shipping (optional)

Delivery bills can be booked with [iShip](https://iship.co.th) straight from
admin → จัดการสถานะ → 🇹🇭 ถึงไทย / บิลค่าส่ง: **🚚 สร้างเลขพัสดุ iShip** compares
every courier's price, books the parcel, saves the tracking number (the bill's
items become "shipped") and gives the A6 label (🖨) and tracking history (📍).
**🚚 เรียกรถเข้ารับ** asks a courier to collect from the shop. iShip's status
updates come back through a webhook and show on the customer status page.
Customers now fill a structured address (with Thai subdistrict autocomplete and
a "paste the whole address" helper), which is what iShip needs.

API docs: https://api-docs.iship.cloud — calls go through the Edge Function
`supabase/functions/iship`; the iShip token stays in Supabase secrets.
**Booking a parcel spends iShip credit.**

1. Run `supabase/migrations/2026-10-31-iship.sql` in the SQL Editor.
2. Get an iShip API token (valid 1 year) with your iShip login. Run this
   yourself; it is the only place your iShip password is used:
   ```bash
   curl -X POST https://app.iship.cloud/api/auth/requestToken -H "Content-Type: application/json" -d '{"phone":"<iShip phone>","password":"<iShip password>"}'
   ```
   Copy `data.accessToken` from the reply.
3. Set the secrets and deploy (`--no-verify-jwt` because iShip's webhook calls
   it without a Supabase login; admin actions still check `is_admin()`):
   ```bash
   npx supabase secrets set ISHIP_TOKEN=<accessToken> ISHIP_WEBHOOK_KEY=<any long random text>
   npx supabase functions deploy iship --no-verify-jwt
   ```
   To try it on iShip's test system first, also set
   `ISHIP_BASE_URL=https://app-uat.iship.cloud` (with a UAT token).
4. Send iShip support your webhook URL:
   `https://<project-ref>.supabase.co/functions/v1/iship?hook=<ISHIP_WEBHOOK_KEY>`
5. In admin, press **⚙️ ตั้งค่าผู้ส่ง iShip** and fill the shop's sender
   address, product category and default parcel size.

Parcels shipped without iShip can still pick a courier in the 📦 status popup,
so customers get the right tracking link (Thailand Post, Flash and KEX open
the courier's page; others open 17TRACK).

## Cloudinary photos (two accounts, cleanup)

Uploads go to the accounts in `js/config.js` → `CLOUDINARY_ACCOUNTS`, in order:
when the first refuses an upload (e.g. its storage is full) the next one is
used, and a red toast says so. Each account needs an **unsigned** upload preset.

Deleting stock also deletes its photos from Cloudinary, unless an order list,
product, option or other stock item still shows them. **🧹** on the stock page
lists every photo nothing uses any more and deletes them on request (photos
used outside this website, e.g. in the old Google Sheet, would be lost too).
Both go through the Edge Function `supabase/functions/cloudinary`; until its
secret is set, deletes leave the photos in place.

1. For each account, copy the API key and secret (Cloudinary → Settings → API Keys).
2. Supabase Dashboard → Edge Functions → Secrets → add `CLOUDINARY_ACCOUNTS`:
   `{"dk5f1v2ro":{"key":"…","secret":"…"},"dkjqjkc6":{"key":"…","secret":"…"}}`
3. `npx supabase functions deploy cloudinary`
