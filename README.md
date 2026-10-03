# ZETAS.id

Fondasi PWA mobile-first untuk pengelolaan pesanan digital Lazada.

## Batas fase ini

- Halaman Login, Dashboard, Pesanan, Detail Pesanan, dan Pengaturan.
- API modular baca-saja, PostgreSQL, versioned migration, dan data awal kosong.
- Fase 2 menyiapkan `users`, `orders`, `order_items`, `sync_logs`, `system_logs`; rincian relasi, preservasi data, dan constraint ada di `docs/database.md`.
- Fase 3 menambahkan pencarian ID/produk, filter Menunggu/Diproses/Selesai, semua item pada detail, dan salin Digital Detail dengan konfirmasi atau fallback pemilihan teks manual. Pencarian/filter tersimpan di URL saat membuka detail dan kembali.
- Fase 4 mengaktifkan login lokal email/password, session PostgreSQL, logout, authorization API, serta pembatasan brute force. Akun hanya dibuat pengelola; lihat `docs/security.md` untuk provisioning, kebijakan, dan kebutuhan HTTPS.
- Fase 5 menyiapkan Docker Compose production, migration otomatis, volume PostgreSQL persisten, health check, serta prosedur install/update aman.
- Fase 6 menyiapkan GitHub Actions untuk install, typecheck, test, build, validasi Compose, audit dependency dan build Docker AMD64/ARM64. Tidak melakukan deployment.
- Fase 7 menambahkan OAuth Lazada Testing dan pemeriksaan koneksi GetSeller di Pengaturan; token terenkripsi dan privat per akun ZETAS. Lihat `docs/lazada-testing.md`.
- Tidak mengambil/memproses order Lazada, tidak ada auto-processing, Telegram Bot, atau Digiflazz.

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

Panduan lengkap: **[docs/deployment.md](docs/deployment.md)**. Dockerfile memakai
image multi-arsitektur tanpa memaksa AMD64. Frontend dan reverse proxy berada
dalam service Nginx `web`, bersama backend `api`, PostgreSQL `database`, dan tugas
`migrate`. Docker Compose v2.20+ diperlukan.

```sh
cp .env.example .env
chmod 600 .env
# Isi environment privat dan siapkan HTTPS proxy host.
docker compose config --quiet
sh deploy/stack.sh install
```

Port internal default `127.0.0.1:8080` hanya untuk proxy HTTPS tepercaya.
Database/API tidak mengekspos port publik. Startup: PostgreSQL sehat → migration
sukses → API sehat → web sehat. Login production wajib HTTPS.

### Update tanpa menghapus data

```sh
sh deploy/stack.sh update
```

Script build dahulu, hentikan aplikasi, backup database, jalankan migration baru,
lalu hidupkan API/web. Nama volume tetap **`zetas-id_postgres_data`** agar data
instalasi sebelumnya dipertahankan. **Jangan gunakan `docker compose down -v`,
`docker volume prune`, atau menghapus volume saat update.** Salin backup keluar
host. Jangan mengganti major PostgreSQL tanpa rencana upgrade.

### Migration berikutnya

Ubah model, buat migration baru, lalu tinjau SQL sebelum menjalankannya:

```sh
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run migrate
```

Jangan mengubah atau menghapus migration yang sudah diterapkan. Gunakan perubahan tambahan yang kompatibel; tidak ada reset/drop otomatis pada startup atau update. Untuk database produksi yang dikelola Replit, ikuti alur Publish Replit; service migration Compose ditujukan untuk PostgreSQL self-hosted.

### Build image multi-platform

Periksa manifest image resmi dan dependency:

```sh
node scripts/check-container-platforms.mjs
```

Perintah buildx AMD64/ARM64, backup/restore, contoh HTTPS, troubleshooting dan
batas pengujian Replit tersedia pada panduan deployment.
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

Workflow `.github/workflows/ci.yml` aktif untuk push `main`/`master`, pull request
dan pemicu manual. Panduan singkat, cakupan audit dependency, dan batas verifikasi
ada di **[docs/ci.md](docs/ci.md)**. Workflow hanya melakukan checks/build,
tanpa publish image atau deployment ke STB.

`pnpm-lock.yaml`, source, Dockerfile, Compose, dan migration disimpan di Git. `.env*` asli, private key, dependency, dan hasil build diabaikan. Hanya `.env.example` berisi placeholder.

Periksa perubahan sebelum commit:

```sh
git status
git diff --check
```

Tidak ada credential atau secret aktual di repository. Jangan menaruh secret dalam variabel `VITE_*` karena variabel frontend masuk ke bundle browser.