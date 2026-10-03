# GitHub Actions — ZETAS.id

Workflow: `.github/workflows/ci.yml`. Berjalan pada push ke `main`/`master`,
semua pull request, serta manual melalui tab **Actions → ZETAS.id CI → Run workflow**.
Upload repository dengan source, lockfile dan migrations; tidak perlu secret
production, credential registry, SSH, atau akses STB.

## Pemeriksaan

1. Node 24 dan pnpm sesuai `packageManager`, install dengan frozen lockfile.
2. Typecheck seluruh workspace; build frontend production dan backend/migration.
3. PostgreSQL 17 disposable milik job, migration otomatis sebelum test.
4. API test dan preview hasil build frontend, lalu seluruh `pnpm test`: login,
   authorization, data pesanan, PWA, preservasi/rollback migration dan konfigurasi
   deployment. Suite dijalankan berurutan karena fixture memakai database yang
   sama. Proses sementara dihentikan setelah test.
5. Validasi Compose dengan `config --quiet`, menggunakan environment tes saja.
6. Audit dependency production: high/critical **memblokir** CI.
   Audit **seluruh** dependency termasuk dev/codegen/authoring dilaporkan sebagai
   peringatan nonblocking; JSON dapat diunduh sebagai artifact `dependency-audit`.
   Audit production bukan audit lengkap bundle frontend karena dependency frontend
   disimpan sebagai devDependencies. Baseline 2026-10-03: production bersih;
   audit penuh menemukan 3 high dan 2 moderate pada tooling (braces,
   brace-expansion, fast-uri). Temuan tersebut tidak di-ignore/dihapus dari laporan;
   status CI hijau tidak berarti seluruh devDependencies bebas advisory.
7. Setelah checks sukses, Docker Buildx + QEMU membangun target `api`, `web`,
   `migrate`, masing-masing untuk **linux/amd64 dan linux/arm64**.
   Hasil disimpan sebagai build cache, bukan dipush ke registry atau di-load ke
   Docker host. Ini memverifikasi build, bukan runtime ARM64 atau deployment.

GitHub Actions dipin ke commit SHA; update action/lockfile melalui review.
Workflow memakai izin `contents: read`, tanpa `pull_request_target` atau login
registry, dan checkout tidak mempertahankan credential. Secret session tes dibuat
acak saat job berjalan dan dimask pada log. Password PostgreSQL berasal dari
identifier run untuk fixture ephemeral, **bukan credential production**.
Jangan pakai database/session secret production dalam CI atau mengunggah `.env`,
private key, dump database, maupun log privat.

## Verifikasi lokal

Di Replit, jalankan typecheck/build, `pnpm test`, dan validasi workflow jika
`actionlint` tersedia:

```sh
actionlint .github/workflows/ci.yml
pnpm run typecheck
PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/zetas-id run build
pnpm --filter @workspace/api-server run build
pnpm test
pnpm audit --prod --audit-level high
```

`scripts/ci-tests.sh` ditujukan untuk PostgreSQL tes yang sudah dimigrasikan dan
`SESSION_SECRET` tes privat. Script membaca environment, bukan file credential,
dan membutuhkan port kosong. `CI_API_PORT`/`CI_WEB_PORT` dapat diubah untuk
validasi lokal tanpa mengganggu preview Replit; sesuaikan `TEST_API_URL`,
`TEST_BASE_URL`, `APP_ORIGIN` jika sudah diset.
Gunakan database disposable dan secret session acak per run, bukan database
aktif atau secret session tetap: counter anti-brute-force tersimpan di PostgreSQL
dan dapat memengaruhi pengulangan tes.

GitHub Actions belum dapat dinyatakan sukses sebelum workflow benar-benar
dijalankan di GitHub. Build image multi-platform memerlukan Docker daemon/QEMU
runner GitHub, tidak tersedia pada workspace Replit ini.

**Tidak ada deploy ke STB, publish image, maupun integrasi Lazada/Telegram/Digiflazz.**