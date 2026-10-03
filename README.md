# ZETAS.id

Fondasi PWA mobile-first untuk pengelolaan pesanan digital Lazada.

## Batas fase ini

- Halaman Login, Dashboard, Pesanan, Detail Pesanan, dan Pengaturan.
- API modular baca-saja, PostgreSQL, versioned migration, dan data awal kosong.
- Fase 2 menyiapkan `users`, `orders`, `order_items`, `sync_logs`, `system_logs`; rincian relasi, preservasi data, dan constraint ada di `docs/database.md`.
- Fase 3 menambahkan pencarian ID/produk, filter Menunggu/Diproses/Selesai, semua item pada detail, dan salin Digital Detail dengan konfirmasi atau fallback pemilihan teks manual. Pencarian/filter tersimpan di URL saat membuka detail dan kembali.
- Fase 4 mengaktifkan login lokal email/password, session PostgreSQL, logout, authorization API, serta pembatasan brute force. Akun hanya dibuat pengelola; lihat `docs/security.md` untuk provisioning, kebijakan, dan kebutuhan HTTPS.
- Tidak ada integrasi Lazada, Telegram Bot, Digiflazz, atau auto-processing.
- Pengaturan menampilkan informasi fondasi dan status server; belum ada konfigurasi integrasi.

## Struktur

```text
artifacts/zetas-id/          React + Vite, halaman dan komponen PWA
artifacts/api-server/        Express API
  src/routes/               HTTP routing dan validasi
  src/modules/orders/       Akses data domain pesanan
lib/api-spec/openapi.yaml    Kontrak API
lib/api-client-react/       Client React Query hasil codegen
lib/api-zod/                Validator hasil codegen
lib/db/src/schema/          Model Drizzle PostgreSQL
lib/db/migrations/          Migration SQL versi terkontrol
deploy/nginx.conf           Static frontend, SPA routing, dan API reverse proxy
tests/                     Smoke test API, PWA, dan retensi data saat migration
```

## Menjalankan di Replit

Frontend dan API dijalankan melalui workflow yang tersedia. `DATABASE_URL` harus disediakan melalui environment, tidak ditulis ke source code.

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run migrate
pnpm run typecheck
pnpm run test:db
pnpm test
```

Tes API menggunakan proxy lokal `http://localhost:80`. Untuk lingkungan lain, set `TEST_BASE_URL` untuk frontend dan `TEST_API_URL` untuk API. Tes migration/schema memakai schema terisolasi yang di-rollback; tes API membuat fixture ber-ID acak dan menghapus **hanya fixture milik tes** setelah selesai. Tes pencarian mencakup order lama di luar 100 data terbaru, karakter `%`/`_` literal, filter status, dan Digital Detail JSON/string/null.

## Docker Compose: Linux amd64 dan arm64

Dockerfile memakai image multi-arsitektur dan tidak memaksa satu arsitektur. Native dependencies Linux arm64 dipertahankan di lockfile. `docker compose build` membangun untuk arsitektur host. Node 24 dan Docker Compose v2 diperlukan.

```sh
cp .env.example .env
# Isi .env dengan nilai deployment sendiri.
docker compose --env-file .env config --quiet
docker compose up -d --build
```

Aplikasi tersedia pada `http://localhost:8080` secara default. Database tidak mengekspos port publik.

Urutan startup: PostgreSQL sehat → service `migrate` selesai sukses → API sehat → frontend. PostgreSQL membuat database pertama kali; migration membuat enum dan tabel aplikasi. Migration gagal akan menghentikan startup API, bukan menghapus data.

`POSTGRES_PASSWORD` dan password dalam `DATABASE_URL` harus sama. URL-encode karakter khusus dalam password URL. Environment dapat diberikan oleh pengelola secret host; `.env` lokal hanyalah pilihan untuk Compose dan tidak masuk Git.

### Update tanpa menghapus data

1. Buat backup terlebih dahulu.
2. Pertahankan nama project Compose `zetas-id` dan volume yang sama.
3. Ambil source versi baru, lalu:

```sh
docker compose build
docker compose run --rm migrate
docker compose up -d --remove-orphans
```

`postgres_data` adalah named persistent volume. Container aplikasi dapat dibangun ulang tanpa menghapus database. **Jangan gunakan `docker compose down -v`, `docker volume prune`, atau menghapus volume saat update.** Jangan mengganti versi mayor PostgreSQL tanpa rencana upgrade database.

Contoh backup:

```sh
mkdir -p backups
docker compose exec -T database sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backups/zetas.sql
```

Simpan backup di lokasi aman di luar repository dan host aplikasi.

### Migration berikutnya

Ubah model, buat migration baru, lalu tinjau SQL sebelum menjalankannya:

```sh
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run migrate
```

Jangan mengubah atau menghapus migration yang sudah diterapkan. Gunakan perubahan tambahan yang kompatibel; tidak ada reset/drop otomatis pada startup atau update. Untuk database produksi yang dikelola Replit, ikuti alur Publish Replit; service migration Compose ditujukan untuk PostgreSQL self-hosted.

### Build image multi-platform

Untuk registry sendiri, gunakan builder multi-platform dan ganti nama image:

```sh
docker buildx build --platform linux/amd64,linux/arm64 --target api -t REGISTRY/zetas-api:VERSION --push .
docker buildx build --platform linux/amd64,linux/arm64 --target web -t REGISTRY/zetas-web:VERSION --push .
docker buildx build --platform linux/amd64,linux/arm64 --target migrate -t REGISTRY/zetas-migrate:VERSION --push .
```

## PWA

Manifest, ikon PNG 192/512, dan service worker tersedia. Service worker aktif pada build production, menyimpan shell/aset statis saja, dan **tidak menyimpan respons API atau data pesanan**. Tanpa koneksi, shell bisa dibuka tetapi data server tidak tersedia.

Instalasi PWA memerlukan HTTPS (kecuali localhost). Untuk host Linux, pasang HTTPS pada reverse proxy host di depan Compose. Rebuild aplikasi memperbarui aset ber-hash; naikkan versi cache service worker bila strategi cache berubah.

## API dasar

- `GET /api/healthz` — konektivitas server dan PostgreSQL
- `GET /api/dashboard/summary` — jumlah tiap status, total nilai pesanan selesai, 5 pesanan terbaru
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` — login/session/logout; logout memerlukan CSRF token.
- `GET /api/orders?search=...&status=...` — memerlukan authorization, maksimal 100 pesanan terbaru yang cocok; pencarian ID Lazada/nama produk dan filter dijalankan di PostgreSQL sebelum limit. Parameter invalid menghasilkan 400.
- `GET /api/orders/:orderId` — header dan semua item beserta Digital Detail berdasarkan UUID, 400/404 untuk ID salah/tidak ada

Kontrak berada di OpenAPI. Setelah kontrak diubah:

```sh
pnpm --filter @workspace/api-spec run codegen
```

## Siap GitHub

`pnpm-lock.yaml`, source, Dockerfile, Compose, dan migration disimpan di Git. `.env*` asli, private key, dependency, dan hasil build diabaikan. Hanya `.env.example` berisi placeholder.

Periksa perubahan sebelum commit:

```sh
git status
git diff --check
```

Tidak ada credential atau secret aktual di repository. Jangan menaruh secret dalam variabel `VITE_*` karena variabel frontend masuk ke bundle browser.