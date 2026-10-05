# ZETAS.id

PWA internal untuk memantau pesanan Lazada dan membantu operator mengirim detail digital secara manual. Ringkasan ini mengikuti implementasi source saat ini; label fase lama di beberapa dokumen bukan inventaris fitur.

## Status fitur

| Status | Area | Implementasi yang ada |
|---|---|---|
| IMPLEMENTED | Web/PWA | Login, Dashboard, Pesanan, Detail Pesanan, Pengaturan; pencarian dan filter; service worker hanya menyimpan shell/aset statis. |
| IMPLEMENTED | Akun | Login email/kata sandi lokal, session tersimpan di PostgreSQL dan diperpanjang saat aktif, logout dan provisioning oleh operator. |
| IMPLEMENTED | Lazada Testing | OAuth Seller In-house, pemeriksaan koneksi `GetSeller`, penyimpanan token terenkripsi per akun. |
| IMPLEMENTED | Order | Sinkronisasi manual baca-saja memakai `GetOrders`/`GetOrderItems`; push bertanda tangan masuk ke antrean durable dan diproses worker; rekonsiliasi berkala. |
| IMPLEMENTED | DeliverDigital | Aksi eksplisit operator pada pesanan yang memenuhi syarat. Bukan proses otomatis. |
| NOT IMPLEMENTED | Integrasi lain | Tidak ditemukan alur Telegram Bot, Digiflazz, atau pengiriman digital otomatis. |
| UNKNOWN | Sistem live | Source menyediakan konfigurasi Replit dan Compose, tetapi status deployment aktif, koneksi Seller Center terkini, serta verifikasi endpoint publik tidak dapat dipastikan dari repository. |

Pesanan Lazada tidak ditulis ulang hanya untuk mengubah kelompok tampilannya. Status asli disimpan dan status tampilan dihitung dari status item saat dibaca. Status yang tidak dikenal tetap tidak terpetakan.

## Susunan repository

```text
artifacts/zetas-id/             React, Vite, halaman dan komponen PWA
artifacts/api-server/           Express API, autentikasi dan modul domain
lib/api-spec/openapi.yaml       Kontrak API
lib/api-client-react/           Client React Query yang dihasilkan
lib/api-zod/                    Validator kontrak yang dihasilkan
lib/db/src/schema/              Skema PostgreSQL dengan Drizzle
lib/db/migrations/              Migration SQL versi terkontrol
deploy/                         Docker Compose, Nginx, backup/update scripts
tests/                          Test integrasi, migration, security dan Docker
docs/                           Panduan operasional per topik
```

Arsitektur dan batas layanan lebih rinci: [ARCHITECTURE.md](ARCHITECTURE.md). Aturan perubahan: [PROJECT_RULES.md](PROJECT_RULES.md). Konteks kerja agent: [AI_CONTEXT.md](AI_CONTEXT.md). Milestone Git yang dapat dibuktikan: [CHANGELOG.md](CHANGELOG.md).

## Development

Workspace memakai pnpm. Node.js 24 dikonfigurasi di Replit. Di Replit, gunakan workflow yang sudah tersedia: `artifacts/zetas-id: web` dan `artifacts/api-server: API Server`. Tidak ada script `dev` di root. Di luar Replit, kedua package memiliki script masing-masing; frontend dan API perlu disediakan pada origin/proxy yang sama agar request `/api` mencapai backend.

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run migrate
pnpm run typecheck
pnpm test:db
pnpm test
```

Siapkan `DATABASE_URL` dan `SESSION_SECRET` melalui environment privat sebelum migration atau API dijalankan. Test integrasi memakai PostgreSQL dan layanan web/API; jalankan pada database test yang dapat dibuang, bukan database berisi data operasional. Runner CI ada di `scripts/ci-tests.sh`; alur lengkap install/build/test dicatat di [docs/ci.md](docs/ci.md).

Build workspace:

```sh
pnpm run build
```

Setelah mengubah kontrak API, perbarui sumber OpenAPI, lalu buat ulang client dan validator:

```sh
pnpm --filter @workspace/api-spec run codegen
```

## Variabel environment

Tabel ini mencantumkan nama dan fungsi, bukan nilai. Ambil nilai privat dari pengelola environment/secrets; jangan menaruh credential di source atau `VITE_*`.

| Kelompok | Nama | Fungsi |
|---|---|---|
| Runtime | `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN`, `LOG_LEVEL`, `TRUST_PROXY`, `NODE_ENV` | Koneksi PostgreSQL, kunci session/digest, origin yang dipercaya, logging, alamat proxy tepercaya, dan mode runtime. `SESSION_SECRET` wajib minimal 32 karakter. |
| Web/API | `PORT`, `BASE_PATH` | Port service dan base path Vite; keduanya wajib diberikan oleh workflow masing-masing. |
| Lazada | `LAZADA_MODE`, `LAZADA_COUNTRY`, `LAZADA_SITE`, `LAZADA_APP_KEY`, `LAZADA_APP_SECRET`, `LAZADA_REDIRECT_URI`, `LAZADA_TOKEN_ENCRYPTION_KEY` | Konfigurasi Seller In-house, OAuth, routing API, identitas site push, dan enkripsi token. Mode yang didukung aplikasi saat ini adalah `testing`; kunci enkripsi harus berupa 64 digit heksadesimal. `LAZADA_SITE` dan negara API adalah pengaturan berbeda. |
| Provisioning akun | `AUTH_SETUP_EMAIL`, `AUTH_SETUP_PASSWORD` | Input sementara untuk script operator `manage-users`; bukan endpoint pendaftaran web. |
| Compose | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `APP_BIND`, `APP_PORT` | Database internal dan bind/port reverse proxy Compose. |
| Test | `CI_API_PORT`, `CI_WEB_PORT`, `TEST_API_URL`, `TEST_BASE_URL` | Alamat service test; gunakan database khusus test bersama `DATABASE_URL`. |

Jangan mencetak, menempelkan, atau mengirim nilai secret ke log, dokumentasi, issue, atau output shell. Untuk deployment, ikuti [docs/deployment.md](docs/deployment.md) dan [docs/security.md](docs/security.md).

## API utama

Sebagian besar API data dan operasi aplikasi memakai session authentication melalui middleware `requireSession`; alur health, autentikasi, dan callback OAuth memiliki pemeriksaan tersendiri. `POST /api/lazada/orders/push` adalah pengecualian: route ini dipasang di luar middleware `requireSession` dan tidak menggunakan login session karena dipanggil oleh Lazada. Push tetap mewajibkan HTTPS dan memverifikasi signature HMAC-SHA256 atas raw request body. Mutasi yang memakai session juga memerlukan same-origin dan CSRF. Jangan mencantumkan secret atau token di dokumentasi maupun log.

- `GET /api/healthz` — memastikan API dapat mencapai PostgreSQL.
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` — session lokal.
- `GET /api/dashboard/summary` — ringkasan dan lima pesanan terbaru.
- `GET /api/orders?search=...&status=...`, `GET /api/orders/:orderId` — daftar/detail.
- `POST /api/lazada/oauth/authorize`, `GET /api/lazada/oauth/callback`, `GET /api/lazada/connection`, `POST /api/lazada/check` — OAuth dan pemeriksaan koneksi.
- `POST /api/lazada/orders/sync` — pembacaan halaman order manual; bukan perintah tulis ke Lazada.
- `POST /api/lazada/orders/push` — pengecualian tanpa login session, dipanggil oleh Lazada; HTTPS dan HMAC-SHA256 signature wajib, ACK diberikan setelah event tersimpan.
- `GET /api/lazada/orders/push-status` — status antrean/rekonsiliasi.
- `POST /api/orders/:orderId/deliver-digital` — pengiriman digital manual oleh operator.

Kontrak dan validasi ada di `lib/api-spec/openapi.yaml` dan package `lib/api-zod`.

## Deployment dan operasi

Compose menyiapkan PostgreSQL, migration, API, dan Nginx web. Database/API tidak dipublikasikan sebagai port publik; contoh deployment memasang TLS pada Nginx host di depan service web. Script install/update dan prosedur backup ada di [docs/deployment.md](docs/deployment.md). Jangan menghapus volume data saat update; tinjau migration dan backup sebelum menjalankan perubahan database.

GitHub Actions menjalankan pemeriksaan CI dan workflow terpisah membangun serta menerbitkan image multi-platform ke GHCR pada kondisi yang ditentukan workflow. Repository tidak menunjukkan workflow yang mengirim atau memasang image ke host produksi. Lihat [docs/ci.md](docs/ci.md).

Service worker production hanya menyimpan shell/aset lokal. Ia tidak menyimpan API, kredensial, atau data pesanan. Penggunaan PWA dan endpoint push memerlukan HTTPS.