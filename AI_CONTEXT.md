# AI Context — ZETAS.id

## Ringkasan produk

ZETAS.id adalah PWA internal untuk operator yang memantau order Lazada dan melakukan tindakan DeliverDigital secara manual. Akun memakai login lokal PostgreSQL; order yang dibaca melalui UI merupakan data workspace bersama, sedangkan koneksi OAuth disimpan per akun.

Gunakan source, schema, test, serta workflow terkini sebagai bukti implementasi. `README.md` dan sebagian dokumen bertahap lama pernah menyatakan bahwa order sync, webhook, atau DeliverDigital belum tersedia; pernyataan itu sudah tidak sesuai dengan source saat ini. Dokumen terperinci di `docs/` tidak termasuk dalam rekonsiliasi handoff ini dan perlu dicocokkan lagi sebelum dipakai sebagai kontrak perilaku.

## Status implementasi yang dikonfirmasi

**IMPLEMENTED**

- PWA React/Vite dengan Login, Dashboard, Pesanan, Detail Pesanan, Pengaturan, search/filter, dan cache shell offline.
- Express API, PostgreSQL/Drizzle, migration versioned, autentikasi lokal dan session rolling 30 hari.
- OAuth Lazada Seller In-house dalam mode Testing, pemeriksaan `GetSeller`, serta token terenkripsi per user.
- Manual, read-only order sync melalui `GetOrders`/`GetOrderItems`.
- Signed order push, validasi raw-body HMAC, durable/idempotent receipt, worker import dan rekonsiliasi berkala.
- Pengelompokan status saat dibaca; status provider asli dipertahankan dan unknown tidak ditebak.
- DeliverDigital manual yang memerlukan operator, order/item eligible, dan konfirmasi provider.
- Compose self-host, Replit deployment configuration, CI, serta publikasi image GHCR.

**NOT IMPLEMENTED / tidak ditemukan di source saat ditinjau**

- Auto-delivery digital melalui worker/timer.
- Telegram Bot atau Digiflazz.
- Lazada production-mode pada konfigurasi aplikasi saat ini.
- Workflow GitHub yang memasang atau mengirim image ke host produksi.

**PLANNED / arah prioritas belum dibuktikan source**

1. UI Pesanan
2. Detail Pesanan
3. Dashboard
4. Pengaturan

Keempat halaman/area tersebut sudah ada. Daftar ini hanya kandidat fokus pengembangan lanjutan yang diminta untuk ditandai planned; detail pekerjaan, pemilik, dan jadwalnya belum ditetapkan di repository.

## Aturan domain yang tidak boleh hilang

- Status header/item asli berasal dari data Lazada. Group ZETAS dihitung sebagai read projection dan dipakai konsisten untuk list, detail, filter, dan ringkasan.
- Status yang tidak dikenal atau status item yang tidak lengkap menghasilkan group `null`; jangan menyimpulkan Menunggu.
- Push meminta server membaca order/items terbaru dari Lazada; payload notifikasi tidak langsung mengubah status tersimpan.
- `LAZADA_COUNTRY` menentukan routing API seller; `LAZADA_SITE` mengidentifikasi site webhook. Nilainya tidak boleh dianggap sama otomatis.
- Manual sync, push worker, dan rekonsiliasi membaca order. Hanya aksi operator khusus yang memanggil DeliverDigital.
- DeliverDigital tidak boleh dianggap berhasil sebelum Lazada mengonfirmasi seluruh item dan status terbaru dapat diverifikasi. Hasil ambigu harus tetap aman dari pengiriman ulang buta.
- Browser tidak menyimpan API response/cache order offline. Service worker hanya menangani shell dan aset.

Aturan lebih lengkap ada di `PROJECT_RULES.md`; peta komponen dan request flow ada di `ARCHITECTURE.md`.

## Konfigurasi dan bukti eksternal

- Variabel runtime yang digunakan termasuk `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN`, `TRUST_PROXY`, `PORT`, `BASE_PATH`, dan konfigurasi `LAZADA_*`. Nama saja dicatat di README; nilai harus tetap di secret/environment manager.
- `SESSION_SECRET` minimal 32 karakter. Mode Lazada yang diterima aplikasi adalah `testing`.
- Konteks terakhir yang diberikan pengguna menyebut Seller In-house APP mereka berstatus Testing. Repository sendiri tidak membuktikan apakah status console, token, akun seller, certificate publik, URL callback publik, atau deployment live masih sama sekarang.
- Source memiliki handler webhook dan test simulasi, tetapi itu tidak membuktikan bahwa internet publik dapat menjangkau endpoint atau bahwa Lazada console sedang mengirim ke sana.
- `.replit` menyertakan konfigurasi deployment Replit; Compose dan Nginx menyediakan opsi self-host. Status deployment aktual harus dicek pada platform/host, bukan ditebak dari file konfigurasi.

## Panduan untuk sesi agent berikutnya

1. Periksa `git status`, file terkait, dan test sebelum mengubah apa pun.
2. Pastikan dokumentasi tidak membuat ulang klaim fase lama yang bertentangan dengan implementasi.
3. Untuk status Lazada yang ambigu, periksa alur resmi serta raw status dalam source/test; jangan menyimpulkan dari nama group UI.
4. Untuk webhook, pertahankan raw-body signature dan trust proxy boundary. Jangan menciptakan bypass atau kontrak Verify yang tidak didukung bukti.
5. Gunakan database test disposable. Jangan migrasikan/reset data operasional untuk validasi dokumentasi atau test.
6. Jangan mengungkap nilai environment/secret dalam jawaban, log, atau file documentation.
