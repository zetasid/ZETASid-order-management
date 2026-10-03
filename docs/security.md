# Login dan keamanan ZETAS.id — fase 4

## Akses

- Login lokal email/password, **tanpa pendaftaran publik**, OAuth, atau layanan autentikasi eksternal.
- Akun aktif yang dibuat melalui console pengelola adalah operator berizin untuk membaca pesanan milik sistem. Ini bukan aplikasi multi-tenant dengan pemilik berbeda per order.
- Seluruh halaman operasional memerlukan session; seluruh API selain health check dan login memerlukan authorization server-side, termasuk endpoint yang tidak dikenal.
- API pesanan masih baca-saja. POST/PUT/PATCH/DELETE ditolak: 401 tanpa session, 405 bagi operator yang login. Tidak ada endpoint HTTP untuk membuat akun, mengganti password, atau mengubah izin.
- Profil lama tanpa `password_hash` tidak memiliki password default dan tidak dapat login.

## Password dan session

- Password baru 12–128 karakter. Scrypt `N=65536, r=8, p=2`, salt acak 128-bit, hasil 512-bit; perbandingan memakai `timingSafeEqual`.
- Tidak ada password plaintext di PostgreSQL. Penulisan/verifikasi menggunakan Node crypto, kompatibel Linux amd64/arm64 tanpa addon native khusus.
- Token session acak 256-bit, hanya cookie HttpOnly host-only; database menyimpan HMAC token, bukan token aslinya.
- Cookie SameSite=Strict, Path=/, Secure pada HTTPS/production. HTTP lokal hanya untuk pengembangan. Production **wajib HTTPS** dan `SESSION_SECRET` acak minimal 32 karakter; jangan pakai nilai placeholder `.env.example`.
- Idle timeout 30 menit; masa hidup absolut 8 jam. Aktivitas API memperpanjang batas idle, tidak melewati batas absolut. Session bertahan lintas restart selama database dan secret dipertahankan.
- Login merotasi session yang sedang dipakai. Logout menghapus session dari PostgreSQL dan cookie browser. Reset password/nonaktifkan akun melalui console mencabut seluruh session akun.
- Penerbitan session dikunci dan memeriksa ulang hash/keaktifan akun dalam transaksi agar verifikasi password lama yang sedang berjalan tidak melewati reset/nonaktifkan akun.
- CSRF token disimpan hanya di memori frontend. Logout memerlukan `X-CSRF-Token`; Origin/cross-site diperiksa pada login dan logout. Tidak ada credential di localStorage atau cache PWA.
- Logout/401 menghapus cache query privat; tab lain menerima event logout. Respons pemulihan session lama dibatalkan/diabaikan agar tidak mengembalikan state login setelah logout.

## Pembatasan dan error

- Maksimum 5 percobaan per email per 15 menit, serta 30 per IP per 15 menit. Percobaan ke-6/31 menghasilkan 429 dan `Retry-After`.
- Counter disimpan melalui upsert transaksi PostgreSQL: lintas proses/restart, bukan limiter memory saja. Email/IP menjadi key HMAC, bukan disimpan plaintext pada tabel limiter.
- Login berhasil mereset counter email, bukan counter IP. Akun yang terkunci sementara tetap harus menunggu batas waktu; hindari mencoba ulang terus-menerus.
- Maksimal 4 verifikasi password bersamaan membatasi pemakaian CPU/memori.
- Email yang tidak terdaftar memakai dummy hash dengan parameter yang sama. Pesan gagal login tidak mengungkap keberadaan/keaktifan akun.
- Input JSON ketat; tambahan field login ditolak, panjang dibatasi, ukuran body maksimal 16 KB. Error malformed/oversize generik 400/413, tanpa echo input.
- Logger hanya mencatat method/path/status, tidak body/query/header sensitif; exception mentah tidak ditulis karena bisa mengandung password, token, SQL parameter, atau URL database.
- Data/API memakai `Cache-Control: no-store`; worker PWA tidak menyimpan API. Helmet memberi header pengamanan pada API.
- Data session kedaluwarsa dan bucket limiter lama dibersihkan berkala. Bucket yang masih berlaku tidak di-reset oleh maintenance.

## Akun pertama dan operasi pengelola

Set `AUTH_SETUP_EMAIL` dan `AUTH_SETUP_PASSWORD` melalui Secrets atau environment privat pengelola. Jangan masukkan credential ke source, argumen command, file yang dikomit, atau chat.

Setelah API dibangun dan migration selesai:

```sh
node artifacts/api-server/dist/manage-users.mjs create
# Operasi hanya dilakukan dari console yang dipercaya:
node artifacts/api-server/dist/manage-users.mjs reset-password
node artifacts/api-server/dist/manage-users.mjs disable
```

Untuk Docker:

```sh
docker compose exec -e AUTH_SETUP_EMAIL -e AUTH_SETUP_PASSWORD api node dist/manage-users.mjs create
```

Variabel tersebut harus tersedia pada environment console yang menjalankan command. Nilai tidak ditulis pada command line. `disable` hanya memerlukan email. `create` tidak menimpa password akun yang sudah aktif; gunakan `reset-password` secara eksplisit.

CLI tidak mencetak email/password/hash. Secret setup tidak dipakai saat startup API; hapus secret setup setelah provisioning bila tidak lagi diperlukan. Jangan mengubah `SESSION_SECRET` tanpa memahami bahwa seluruh session yang ada akan tidak valid.

## Deployment

- `SESSION_SECRET` dan `APP_ORIGIN` disediakan melalui environment Compose. `APP_ORIGIN` adalah origin HTTPS publik yang benar; domain pengembangan bukan domain production.
- TLS termination harus dikonfigurasi di reverse proxy host. Jangan mengekspos API/PostgreSQL langsung ke internet. Web Compose default bind localhost; host proxy menimpa forwarding headers, lalu Nginx container meneruskan IP/protokol yang dinormalisasi. Backend mempercayai satu hop terakhir. Jangan membuka port web privat ke klien publik atau meneruskan IP yang tidak dipercaya. Lihat `docs/deployment.md`.
- Header Host dipertahankan oleh Nginx. Jangan mengganti validasi Origin dengan wildcard/CORS credentials terbuka.
- Nginx production memberi CSP, nosniff dan Referrer-Policy, termasuk HTML hasil routing SPA; kebijakan cache diletakkan di server agar tidak menghilangkan pewarisan header keamanan.
- Backup PostgreSQL sekarang mencakup hash password dan data autentikasi; simpan dengan akses terbatas.

### Catatan preview pengembangan

Pemeriksaan lingkungan ini menunjukkan backend langsung dan proxy lokal mengirim `SameSite=Strict`, tetapi proxy preview HTTPS mengubah cookie menjadi `SameSite=None; Secure` sebelum diterima browser. Ini bukan perubahan kebijakan dalam source aplikasi. Proteksi Origin dan CSRF tetap wajib, dan pengujian logout lintas tab tetap berhasil. Saat self-host/deploy, periksa atribut cookie pada reverse proxy HTTPS akhir; jangan melemahkan kebijakan aplikasi hanya untuk mengikuti perilaku preview.

## Verifikasi

`pnpm test` membutuhkan API/frontend aktif, migration terbaru, `DATABASE_URL`, serta `SESSION_SECRET`. Fixture akun/password dibuat acak saat runtime dan dihapus hanya berdasarkan identifier milik tes.

Tes meliputi hash/salt, login/rotasi/logout, CSRF/Origin, invalid/expired session, akun nonaktif, API anonim dan cookie/bearer palsu, larangan mutasi order, brute-force lockout, input/error aman, dan operasi console. Tes ini adalah pemeriksaan keamanan dasar, bukan sertifikasi/pentest menyeluruh.