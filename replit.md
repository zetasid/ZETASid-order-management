# ZETAS.id

Fondasi PWA mobile-first untuk pengelolaan pesanan digital Lazada.

## Scope yang disepakati

- Fase 1 menyiapkan fondasi project dan UI dasar: Login, Dashboard, Pesanan, Detail Pesanan, Pengaturan.
- Fase 2 hanya menyiapkan database: users, orders, order_items, sync_logs, system_logs, relasi, unique constraint, dan migration aman. Tidak menambahkan UI atau integrasi.
- Tidak ada integrasi Lazada, Telegram Bot, Digiflazz, maupun auto-processing order.
- Data awal kosong. Login belum mengautentikasi dan UI tidak boleh berpura-pura memiliki sesi pengguna.
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
- Target Linux amd64 dan arm64. Jangan menghapus native Linux arm64 packages dari pnpm overrides/lockfile.
- PostgreSQL menggunakan persistent named volume. Update aplikasi tidak boleh menghapus data.
- Compose migration service dipakai untuk PostgreSQL self-hosted; tidak dijalankan otomatis dari startup API pada Replit.
- Detail operasi, backup, build multi-platform, PWA, dan GitHub ada di `README.md`.
- Aturan kompatibilitas legacy, relasi, dan preservasi data ada di `docs/database.md`; jangan membuat ID item fiktif untuk produk header lama.

## Keamanan fase fondasi

API masih baca-saja tanpa auth. Jangan masukkan data pelanggan atau gunakan sebagai sistem produksi publik sebelum autentikasi dan otorisasi ditambahkan dalam fase yang diminta pengguna.