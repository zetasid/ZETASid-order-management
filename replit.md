# ZETAS.id

Fondasi PWA mobile-first untuk pengelolaan pesanan digital Lazada.

## Scope yang disepakati

- Fase 1 menyiapkan fondasi project dan UI dasar: Login, Dashboard, Pesanan, Detail Pesanan, Pengaturan.
- Fase 2 hanya menyiapkan database: users, orders, order_items, sync_logs, system_logs, relasi, unique constraint, dan migration aman. Tidak menambahkan UI atau integrasi.
- Fase 3 UI pesanan mobile-first: dashboard, daftar/detail semua item, pencarian PostgreSQL, filter status, dan salin Digital Detail. Perubahan schema hanya menambahkan enum processing untuk Diproses; cancelled tetap dipertahankan untuk data lama.
- Fase 7 Lazada hanya mode Testing: OAuth dan cek koneksi GetSeller. Jangan mengambil/memproses order, menambah auto-processing, Telegram, Digiflazz, atau permission yang tidak diperlukan. Konfigurasi/pengujian: `docs/lazada-testing.md`.
- Fase 8 mengizinkan pembacaan manual GetOrders/GetOrderItems dan penyimpanan PostgreSQL. Tampilkan status/nilai API asli; Digital Detail hanya dari field yang terbukti. Tidak ada DeliverDigital, auto-processing, Telegram, atau Digiflazz.
- Fase 9 mengizinkan signed Order Status Change PUSH, pembacaan GetOrder/GetOrderItems, upsert atomic, dan backup GetOrders setiap 6 jam. OAuth existing tetap; tidak ada fulfillment/auto-processing. Aktivasi nyata memerlukan HTTPS stabil, Verify/Subscribe/Save Lazada, serta worker always-running. Lihat `docs/lazada-order-push.md`.
- Token Lazada privat per akun ZETAS, walaupun order lokal adalah data shared. Ini mencegah operator lain mengganti atau membaca credential koneksi tanpa role integrasi khusus.
- Fase 4 mengaktifkan login email/password lokal, session PostgreSQL, authorization untuk seluruh data sistem, logout, serta rate limit/anti brute force. Akun dibuat dari console pengelola, tanpa pendaftaran publik.
- Tidak ada credential/password default. Data awal tetap kosong; akun pertama diprovisikan melalui environment/Secrets privat.
- Jangan menambah fitur di luar permintaan. Setelah implementasi dan tes, berhenti menunggu instruksi berikutnya.

## Run & Operate

- Workflow `artifacts/api-server: API Server` dan `artifacts/zetas-id: web`.
- `pnpm run typecheck` — semua package.
- `pnpm test` — API/PWA smoke test dan tes retensi migration; memerlukan server serta `DATABASE_URL`.
- `pnpm run test:db` — tes schema dan migration terisolasi; hanya memerlukan `DATABASE_URL`.
- `pnpm --filter @workspace/api-spec run codegen` — regenerasi client dan validator.
- `pnpm --filter @workspace/db run generate` / `migrate` — versioned migration.
- Secret hanya melalui environment. Jangan mencetak nilai secret.

## Struktur dan target deployment

- React/Vite di `artifacts/zetas-id`; Express modular di `artifacts/api-server`.
- OpenAPI di `lib/api-spec`, model dan migration PostgreSQL di `lib/db`.
- Docker Compose self-hosted dengan `database`, `migrate`, `api`, `web`.
- Fase 5: `docker-compose.yml` menggantikan `compose.yaml`; frontend dan reverse proxy bersama di `web`. Panduan install/update ada di `docs/deployment.md`, script `sh deploy/stack.sh install|update`.
- Fase 6: GitHub CI checks/build saja, tidak deploy ke STB atau publish image. Audit production high/critical memblokir; audit lengkap dev tooling sebagai laporan peringatan. Lihat `docs/ci.md`.
- Target Linux amd64 dan arm64. Jangan menghapus native Linux arm64 packages dari pnpm overrides/lockfile.
- PostgreSQL menggunakan persistent named volume. Update aplikasi tidak boleh menghapus data.
- Compose migration service dipakai untuk PostgreSQL self-hosted; tidak dijalankan otomatis dari startup API pada Replit.
- Detail Docker, HTTPS, backup/restore dan build multi-platform ada di `docs/deployment.md`; PWA dan GitHub ada di `README.md`.
- Aturan kompatibilitas legacy, relasi, dan preservasi data ada di `docs/database.md`; jangan membuat ID item fiktif untuk produk header lama.

## Keamanan

API pesanan tetap baca-saja dan wajib authorized. Seluruh operator aktif yang diprovisikan pengelola berizin membaca pesanan sistem; ini bukan multi-tenant. Production wajib HTTPS, secret session acak, dan reverse proxy terpercaya. Lihat `docs/security.md` untuk provisioning/reset/nonaktifkan akun, timeout, dan pemeriksaan dasar.