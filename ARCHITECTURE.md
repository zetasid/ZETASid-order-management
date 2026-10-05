# Architecture

Dokumen ini menjelaskan arsitektur yang terlihat pada source/configuration repository, bukan bukti bahwa suatu deployment eksternal sedang aktif.

## Gambaran sistem

```text
Operator
  │
  ▼
React + Vite PWA (artifacts/zetas-id)
  │ same-origin /api
  ▼
Nginx web (static files + reverse proxy)
  ├── /api/lazada/orders/push ── raw-body signature handler
  └── /api/* ────────────────── Express API (artifacts/api-server)
                                   ├── auth/session middleware
                                   ├── orders/dashboard read model
                                   ├── Lazada OAuth + provider client
                                   ├── manual sync / DeliverDigital
                                   └── order-push worker
                                         │
                                         ├── Lazada Open Platform
                                         └── PostgreSQL
```

Di Compose, service utama adalah `database`, `migrate`, `api`, dan `web`. Nginx di container `web` melayani bundle SPA dan meneruskan `/api` ke API. Contoh konfigurasi menyediakan TLS pada Nginx host terpisah; port web Compose secara default hanya di-bind ke loopback. Health/startup dependencies menahan aplikasi sampai database dan migration siap. Detail operasional ada di `docs/deployment.md`.

Pada workspace Replit, frontend dan API dijalankan melalui workflow/artifact masing-masing. Pengujian integrasi juga memerlukan PostgreSQL dan alamat test frontend/API.

## Workspace dan batas package

- `artifacts/zetas-id`: React, Vite, Tailwind, React Query; Login, Dashboard, Pesanan, Detail Pesanan, Pengaturan, serta aset PWA.
- `artifacts/api-server`: Express API. `src/routes/` mendaftarkan HTTP endpoints; `src/modules/` memuat aturan auth, Lazada, dan order.
- `lib/api-spec`: kontrak OpenAPI. Orval menghasilkan client React Query di `lib/api-client-react` dan validator Zod di `lib/api-zod`.
- `lib/db`: pool `pg`, Drizzle schema, relasi, dan SQL migration yang disimpan di repository.

Client web menggunakan cookie same-origin dan credential browser. Endpoint app dipanggil melalui `/api`; deployment harus mempertahankan reverse-proxy routing tersebut.

## Data dan persistence

PostgreSQL adalah persistence layer tunggal yang ditunjukkan oleh source. Tabel domain mencakup:

- `users`, `auth_sessions`, `auth_login_buckets`: akun, session, dan rate-limit login.
- `orders`, `order_items`: header dan item order, termasuk snapshot provider dalam JSONB.
- `lazada_connections`, `lazada_oauth_states`: koneksi OAuth per akun dan state sementara authorization.
- `lazada_order_push`, `lazada_order_automation`: receipt/event queue dan cursor/status worker.
- `sync_logs`, `system_logs`: catatan operasi dan log sistem.

Daftar skema aktif berada di `lib/db/src/schema/`; migration incremental ada di `lib/db/migrations/`. Migration runner menggunakan advisory lock. Migration yang sudah diterapkan tidak seharusnya diedit atau dihapus; perubahan schema baru dibuat sebagai migration tambahan dan SQL-nya ditinjau.

Order data pada endpoint list/detail bersifat workspace bersama, bukan row-level multi-tenant berdasarkan operator. Koneksi Lazada dan credential OAuth tetap terkait user yang menghubungkannya.

## Request, session, dan trust boundary

1. `/api` diberi `Cache-Control: no-store`.
2. `GET /api/healthz` memeriksa `SELECT 1` pada database. Router health, auth, dan OAuth callback dipasang sebelum middleware session global; endpoint auth yang perlu session menerapkan pemeriksaan route-level.
3. Sebagian besar route aplikasi setelah `router.use(requireSession)` di `routes/index.ts` memerlukan session aktif. Mutasi yang melewati boundary session memerlukan same-origin dan CSRF token.
4. `POST /api/lazada/orders/push` adalah pengecualian: `app.ts` memasang router Push secara terpisah di luar `requireSession` dan sebelum JSON parser. Lazada memanggil endpoint ini tanpa login session; server mewajibkan HTTPS dan memverifikasi HMAC-SHA256 signature atas byte raw body sebelum memproses payload.
5. Session cookie `HttpOnly`, `SameSite=Strict`, dan `Secure` pada HTTPS/production. Record server-side menyimpan hash token; masa berlaku 30 hari diperpanjang saat aktivitas. Maintenance menghapus session yang kedaluwarsa setiap 10 menit.
6. Login lokal memakai scrypt, quota berbasis PostgreSQL, dan batas jumlah password verification serentak. Akun dibuat/reset/nonaktif oleh script operator, bukan registrasi publik.
7. `TRUST_PROXY` hanya menerima alamat/CIDR yang eksplisit atau nama jaringan yang dibatasi. Reverse proxy host harus menimpa forwarding headers dari klien, bukan meneruskannya tanpa validasi.

Nginx access log tidak mencatat query string, referrer, cookie, atau request body. API request logger juga hanya menyimpan path tanpa query; jangan menambahkan logging token, raw webhook body, credential, atau Digital Detail.

## Alur Lazada

### OAuth dan koneksi

- Aplikasi hanya menerima konfigurasi `LAZADA_MODE=testing`; OAuth dan endpoint sensitif memerlukan HTTPS.
- Callback mengikat OAuth `state` ke sesi browser dan proses authorization, lalu mengarahkan kembali ke halaman Settings.
- Token tersimpan terenkripsi dan terkait user, fingerprint konfigurasi app, dan negara API. Pemeriksaan koneksi menjalankan `GetSeller`.
- Untuk proses otomatis, worker hanya menggunakan tepat satu koneksi aktif/terverifikasi yang cocok dengan fingerprint/country konfigurasi. Ia tidak memilih secara arbitrer jika terdapat beberapa koneksi yang memenuhi syarat.
- `LAZADA_COUNTRY` menentukan routing API seller; `LAZADA_SITE` mengidentifikasi site webhook. Jangan menyamakan atau mengganti keduanya tanpa bukti konfigurasi Lazada.

### Sync manual dan persistence order

`POST /api/lazada/orders/sync` mengambil satu halaman hingga 20 order menggunakan `GetOrders`, lalu `GetOrderItems` per order. Rentang maksimum 366 hari dan proses serial lintas operator untuk konfigurasi app. Data provider divalidasi sebelum ditulis dalam transaction; log mencatat operasi baca. Alur ini tidak memanggil API tulis Lazada.

Order/item menyimpan identifier, timestamp, nilai, status asli, dan field provider terpilih; `digital_delivery_info` menjadi Digital Detail jika provider mengirimnya. `extra_attributes` tidak ditafsirkan sebagai pengganti Digital Detail. Penulisan ulang pada replay yang identik di worker menghindari perubahan row yang tidak perlu.

### Status tampilan

Status item asli tetap ada di snapshot Lazada. Status group ZETAS dihitung pada read model dan dipakai konsisten untuk filter, summary, list, dan detail:

| Status asli | Group |
|---|---|
| `unpaid`, `pending` | `pending` / Menunggu |
| `repacked`, `packed`, `ready_to_ship_pending`, `ready_to_ship`, `shipped`, `topack`, `toship`, `shipping` | `processing` / Diproses |
| `delivered`, `confirmed` | `completed` / Selesai |
| `canceled` | `cancelled` / Dibatalkan |
| Status tidak dikenal atau status item tidak lengkap | Tidak terpetakan (`null`) |

Untuk order multi-item: semua cancelled menghasilkan cancelled; campuran completed/cancelled menghasilkan completed; status processing atau campuran completed/pending menghasilkan processing; kombinasi lain yang diketahui menghasilkan pending. Bila ada item yang tidak dikenal, group tidak ditebak.

### Push dan rekonsiliasi otomatis

1. `POST /api/lazada/orders/push` menerima raw JSON body sampai 16 KiB melalui HTTPS sebelum Express JSON parser.
2. Server memverifikasi `HMAC-SHA256(AppKey + exact raw body, AppSecret)` dengan perbandingan konstan-waktu, memvalidasi skema/site/timestamp dan freshness window, lalu membuat event idempotent yang durable.
3. Request path tidak memanggil API Lazada; ia memberi ACK hanya setelah receipt tersimpan. Event duplikat dalam window yang diterima di-ACK kembali.
4. Worker background berjalan tiap 5 detik, memproses maksimal 3 push per tick, lalu mencoba rekonsiliasi bila jadwalnya tiba. Untuk event, worker membaca order/items terbaru dari Lazada dan menyimpan snapshot; payload push bukan sumber tunggal status order.
5. Retry push memakai exponential backoff mulai 30 detik dan dibatasi 6 jam. Rekonsiliasi memakai jendela update-time, halaman maksimum 20 order, cursor durable, dan dijadwalkan tiap 6 jam setelah halaman terakhir sukses. Kegagalan rekonsiliasi dijadwalkan ulang setelah 5 menit.

`GET /api/lazada/orders/push-status` melaporkan status koneksi/worker, jumlah event pending, waktu sync, dan error aman. Kode ini membuktikan implementasi handler, bukan keterjangkauan publik, sertifikat, atau keberhasilan registrasi webhook pada console Lazada.

### DeliverDigital manual

`POST /api/orders/:orderId/deliver-digital` adalah aksi operator terautentikasi pada HTTPS. Ia menerima order yang status bacaannya masih Menunggu, memerlukan item serta koneksi Lazada operator aktif, mencatat attempt, dan menserialisasi operasi. Respons per item dan status setelahnya diverifikasi. Order baru dilaporkan berhasil sesudah semua item dikonfirmasi dan snapshot terbaru berhasil dibaca; aplikasi tidak menetapkan status selesai secara spekulatif.

Jika hasil provider tidak dapat dipastikan, attempt tetap unresolved/running agar operator tidak mengirim ulang secara buta. Periksa status di Lazada sebelum tindakan ulang. Tidak ada worker atau timer yang memanggil DeliverDigital.

## PWA dan cache

Manifest mendeklarasikan aplikasi standalone dan ikon 192/512. Service worker aktif pada build production, cache shell/aset same-origin, dan menyediakan shell terakhir untuk navigasi offline. Semua request `/api` dilewati; pesanan, session, dan respons server tidak disimpan oleh service worker. Offline tidak berarti data order tersedia.

## CI dan publikasi image

- `ci.yml`: locked dependency install, typecheck, test, build, audit dependency, validasi Compose dan build Docker AMD64/ARM64.
- `docker-publish.yml`: membangun/menerbitkan image ke GHCR pada kondisi workflow yang ditetapkan.
- Tidak ditemukan workflow yang login ke host dan melakukan deployment aplikasi. Compose/update scripts adalah mekanisme self-host yang terpisah.
- Repository menyediakan konfigurasi deployment Replit; status deployment yang benar-benar aktif tetap perlu dicek di platform.
