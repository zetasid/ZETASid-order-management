# Docker Compose — install dan update ZETAS.id

## Arsitektur dan prasyarat

- Host **Linux AMD64 atau ARM64**, Docker Engine dan plugin **Docker Compose v2.20+**.
- Node 24 Debian/glibc untuk build dan runtime API/migration, PostgreSQL 17 Alpine,
  Nginx 1.28 Alpine. Semua tag resmi memiliki manifest `linux/amd64` dan `linux/arm64`.
- Tidak ada `platform: linux/amd64` yang dipaksakan. Install dependency berlangsung
  di dalam image target; jangan menyalin `node_modules` host ke image.
- Service `web` menjalankan **frontend statis dan reverse proxy Nginx** dalam satu
  container. Service `api` menjalankan backend; `database` menyimpan PostgreSQL;
  `migrate` adalah tugas sekali jalan. Tidak ada dev server Vite pada production.
- Database/API tidak menerbitkan port host. `web` default bind `127.0.0.1:8080`,
  hanya untuk proxy HTTPS tepercaya di host. Network database bersifat internal.
- HTTPS, domain dan sertifikat TLS disiapkan di host; contoh konfigurasi tersedia
  di `deploy/https-host.conf.example`. Akses HTTP langsung **bukan** deployment
  login production yang valid karena cookie session menggunakan Secure.
- Tidak ada integrasi Lazada, Telegram, atau Digiflazz.

## Instalasi pertama

1. Ambil source di direktori tetap, misalnya `/opt/zetas-id`.
2. Siapkan environment privat:

   ```sh
   cp .env.example .env
   chmod 600 .env
   ```

   Edit file menggunakan editor privat. Isi:

   | Variabel | Nilai |
   | --- | --- |
   | `POSTGRES_DB`, `POSTGRES_USER` | Default `zetas` |
   | `POSTGRES_PASSWORD` | Password acak yang kuat, disarankan 32 byte hex |
   | `DATABASE_URL` | `postgresql://USER:PASSWORD@database:5432/DATABASE` |
   | `SESSION_SECRET` | Secret acak minimal 32 karakter, disarankan 32 byte hex |
   | `APP_ORIGIN` | Origin HTTPS publik, tanpa path/trailing slash |
   | `APP_BIND`, `APP_PORT` | Default `127.0.0.1`, `8080` |
   | `LOG_LEVEL` | Default `info` |

   Password pada URL harus sama dengan `POSTGRES_PASSWORD`; URL-encode karakter
   khusus. Hex menghindari masalah karakter `$`, `#`, `@` dan interpolasi Compose.
   Buat nilai acak melalui pengelola secret; jangan taruh secret di source,
   argumen command, screenshot, log atau variabel frontend `VITE_*`.
   Alternatif `.env`: injeksikan semua variabel melalui pengelola secret host.
   Jangan jalankan `docker compose config` tanpa `--quiet`, karena output lengkap
   menampilkan environment. Hak akses Docker setara akses administrator host.

3. Jalankan dari root repository:

   ```sh
   docker compose config --quiet
   sh deploy/stack.sh install
   docker compose ps -a
   ```

   Script build image, menunggu database sehat, menjalankan migration otomatis,
   lalu menunggu API dan web sehat. `migrate` berstatus `Exited (0)` adalah normal;
   bukan service daemon. Migration gagal memblokir API/web.

4. Pasang contoh proxy HTTPS pada Nginx **host**, ganti domain/path sertifikat,
   lalu validasi dan reload konfigurasi host. Host proxy wajib **menimpa**
   `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, bukan mempercayai nilai
   kiriman klien. Container web meneruskan IP/protokol yang sudah dinormalisasi
   ke API; Express mempercayai satu hop terakhir. Jangan membuka port 8080 ke
   internet. Jika proxy ada di host lain, gunakan jaringan privat/firewall yang
   hanya mengizinkan proxy tersebut dan atur `APP_BIND` dengan hati-hati.

5. Periksa tanpa login:

   ```sh
   curl --fail http://127.0.0.1:8080/healthz
   curl --fail https://your-domain.example/api/healthz
   ```

   Endpoint pertama memeriksa Nginx; endpoint API juga memeriksa PostgreSQL.
   Service web health check memeriksa keduanya. Health check tidak me-restart
   container unhealthy secara otomatis; restart policy menangani proses keluar.

6. Provisioning akun pertama dari console privat; tidak ada akun/password default.
   Ikuti `docs/security.md`. Environment `AUTH_SETUP_EMAIL` dan
   `AUTH_SETUP_PASSWORD` harus sudah ada pada console tepercaya:

   ```sh
   docker compose exec -e AUTH_SETUP_EMAIL -e AUTH_SETUP_PASSWORD api node dist/manage-users.mjs create
   ```

   Hapus environment setup setelah selesai. Jangan mengirim credential di chat.

## Update tanpa kehilangan PostgreSQL

Pertahankan nama project `zetas-id` dan volume **`zetas-id_postgres_data`**. Nama ini
sama dengan Compose sebelumnya, sehingga data lama tetap dipakai setelah rename
`compose.yaml` menjadi `docker-compose.yml`. Jika instalasi lama memakai `-p`/nama
volume berbeda, cocokkan nama volume di konfigurasi **sebelum** startup; volume
baru yang kosong bukan berarti data lama hilang. Jangan menjalankan dua versi
Compose dari dua checkout secara bersamaan.

1. Ambil source rilis baru tanpa menghapus `.env` dan volume.
2. Jalankan:

   ```sh
   sh deploy/stack.sh update
   docker compose ps -a
   ```

Script melakukan urutan berikut:

1. Validasi environment dan build image baru selagi aplikasi lama berjalan.
2. Pastikan PostgreSQL sehat; hentikan API/web untuk maintenance singkat.
3. Buat backup custom-format `backups/zetas-TIMESTAMP-PID.dump` berizin privat.
4. Jalankan **tugas migration baru** melalui `docker compose run --rm --no-deps migrate`.
5. Hidupkan API/web dan tunggu health check.

Build gagal tidak menghentikan aplikasi lama. Backup atau migration gagal membuat
aplikasi tetap berhenti untuk pemeriksaan, bukan memaksa startup dengan schema
tidak cocok. Backup tetap tersedia. Jangan restart aplikasi sampai penyebabnya
diperbaiki. Salin backup keluar host dan uji restore secara berkala.

Migration terkontrol memakai journal Drizzle yang sama dengan fase sebelumnya.
Pengulangan adalah no-op untuk versi yang sudah diterapkan. Advisory lock
PostgreSQL mencegah dua proses migration berjalan bersamaan; SQL migration
diterapkan melalui transaksi Drizzle. Tidak ada reset/drop otomatis, seed akun,
atau perubahan data saat container dibuat ulang. Jangan edit migration yang
sudah diterapkan; tambahkan file migration baru setelah tinjauan preservasi data.
Jangan menjalankan dua script update bersamaan: lock migration tidak mencakup
backup atau penghentian container.

**Dilarang saat update:** `docker compose down -v`, `docker volume prune`,
menghapus volume, atau mengganti major PostgreSQL tanpa prosedur upgrade.
`docker compose down` tanpa `-v` mempertahankan named volume, tetapi tidak
diperlukan untuk update. Rotasi `POSTGRES_PASSWORD` pada `.env` **tidak** mengganti
password role PostgreSQL yang sudah tersimpan; koordinasikan perubahan role dan
`DATABASE_URL`. Pertahankan `SESSION_SECRET` agar session tidak terputus.

## Backup, restore dan pemulihan

Backup manual:

```sh
umask 077
mkdir -p backups
docker compose exec -T database sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > backups/zetas.dump
```

Periksa exit code; jangan menganggap file kosong sebagai backup sukses.
Backup berisi data pesanan dan hash autentikasi, sehingga wajib dilindungi.

Restore sebaiknya diuji ke **database terpisah yang kosong**, bukan menimpa
production. Setelah membuat database tujuan `zetas_restore` dari console privat:

```sh
docker compose exec -T database sh -c 'pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d zetas_restore' < backups/zetas.dump
```

Perintah ini tidak membuat database tujuan. Verifikasi data sebelum mengalihkan
aplikasi. Restore ke database aktif atau menghapus objek lama adalah tindakan
destruktif dan memerlukan keputusan pengelola. Tidak ada downgrade schema
otomatis; bila kode lama tidak kompatibel dengan schema baru, gunakan prosedur
recovery yang ditinjau, jangan sekadar mengganti image.

## Image dan dependency multi-platform

Pemeriksaan manifest resmi dan lockfile:

```sh
node scripts/check-container-platforms.mjs
```

Script membaca manifest Docker Hub dan memastikan kedua arsitektur tersedia,
serta dependency native build glibc esbuild, Rollup, Tailwind oxide, lightningcss
dipertahankan untuk x64/arm64. API menggunakan `pg` JavaScript dan Node crypto
(scrypt), tanpa bcrypt/argon2 addon native atau `pg-native` wajib.

Build native pada setiap host:

```sh
docker compose build --pull
```

Atau image registry multi-platform, dengan buildx serta builder/QEMU yang sudah
disiapkan pada host Docker:

```sh
docker buildx build --platform linux/amd64,linux/arm64 --target api -t REGISTRY/zetas-api:VERSION --push .
docker buildx build --platform linux/amd64,linux/arm64 --target web -t REGISTRY/zetas-web:VERSION --push .
docker buildx build --platform linux/amd64,linux/arm64 --target migrate -t REGISTRY/zetas-migrate:VERSION --push .
```

Node/Debian dipakai untuk build agar dependency glibc cocok; Nginx/PostgreSQL
Alpine tidak memuat dependency Node tersebut. Runtime API/migrate hanya berisi
bundle production, bukan pnpm/devDependencies atau source seluruh workspace.
Web/API/migrate non-root, read-only, dengan `/tmp` tmpfs dan capability dibuang.
Base image dikunci ke jalur major/minor untuk patch keamanan melalui `--pull`;
untuk rilis identik lintas waktu, pengelola dapat mengunci **digest multi-platform**
yang sudah diverifikasi, bukan digest single-platform. PostgreSQL tetap major 17.

## Validasi di Replit dan batasnya

```sh
pnpm run typecheck
PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/zetas-id run build
pnpm --filter @workspace/api-server run build
node --test tests/deployment.test.mjs
node --test tests/deployment-migrations.test.mjs
node scripts/check-container-platforms.mjs
```

Tes Compose menggunakan nilai dummy, tidak menampilkan secret environment.
Validasi Nginx dapat dilakukan menggunakan Nginx lokal dengan path sementara,
karena layout filesystem Nix berbeda dengan container.

Replit workspace bukan host untuk menjalankan Docker daemon/container. Build
aplikasi, config Compose, sintaks Nginx, dependency/manifest dan perilaku runner
migration dapat diuji di sini; **build image Docker, boot seluruh stack, dan
runtime ARM64 belum dibuktikan oleh tes tersebut**. Jalankan build/start/health,
HTTPS login, backup, update dan restore pada host Docker AMD64/ARM64 sebelum
menggunakan deployment untuk data penting. Tidak ada deployment otomatis ke host.