# Lazada — Testing & OAuth

## Batas implementasi

Hanya OAuth dan cek koneksi manual **GetSeller**. Tidak mengambil order, memproses
order, mengirim notifikasi, melakukan auto-processing, atau memanggil API refresh
secara otomatis. Tidak ada Telegram/Digiflazz.

Status **Testing** adalah status aplikasi di Lazada App Console. Dokumentasi
resmi menggunakan endpoint OAuth/API HTTPS biasa; ini **bukan sandbox terpisah**
dan bukan jaminan bahwa seller data adalah data dummy. Pemeriksaan GetSeller
hanya memverifikasi keberhasilan; isi profil seller tidak disimpan/ditampilkan.
Kode menolak konfigurasi mode selain `testing`; status App Console harus
dikonfirmasi oleh pemilik aplikasi, tidak dapat dibuktikan hanya dari flag lokal.

## Konfigurasi privat backend

Gunakan Replit Secrets/private environment, bukan form frontend atau repository:

| Variable | Isi |
| --- | --- |
| `LAZADA_MODE` | `testing` |
| `LAZADA_COUNTRY` | `id` (default), atau `sg`, `my`, `th`, `vn`, `ph` |
| `LAZADA_APP_KEY` | App Key aplikasi berstatus Testing |
| `LAZADA_APP_SECRET` | App Secret aplikasi itu |
| `LAZADA_TOKEN_ENCRYPTION_KEY` | Key acak independen, 32 byte / 64 karakter hexadecimal |
| `LAZADA_REDIRECT_URI` | `https://DOMAIN-APLIKASI/api/lazada/oauth/callback` |

Callback harus **HTTPS**, tanpa query/fragment/credential, dan persis cocok
dengan Callback URL di App Console. Jika `APP_ORIGIN` dikonfigurasi, origin
callback harus sama. Gunakan domain preview HTTPS untuk pengujian development;
jangan memakai localhost sebagai callback di Lazada. Perubahan konfigurasi
memerlukan restart API.

Compose meneruskan konfigurasi hanya ke service API, bukan frontend/build.
File `.env.example` hanya berisi placeholder kosong. Jangan commit `.env`,
secret, token, log privat, atau dump database.

Key enkripsi harus tetap tersedia setelah restart. Mengubah/menghilangkan key
menjadikan token lama tidak dapat dibaca; status menjadi Tidak Terhubung dan
otorisasi ulang diperlukan. Jangan mengganti key sembarangan. App Key berbeda
atau negara berbeda juga memerlukan otorisasi ulang.

## Persiapan App Console

1. Pastikan aplikasi masih berstatus **Testing**.
2. Daftarkan Callback URL HTTPS di atas.
3. Aktifkan hanya API sistem untuk pertukaran authorization code dan akses
   **GetSeller (`/seller/get`)** yang diperlukan untuk cek koneksi. Tidak ada
   permintaan scope tambahan pada authorization URL.
4. Nonaktifkan izin order/product/finance/fulfillment dan izin lain yang tidak
   diperlukan. Kode tidak dapat mengurangi izin yang sudah diberikan pada App
   Console; periksa sendiri daftar izin sebelum menyetujui otorisasi.
5. Jika authorization policy app adalah **Allow binding user to authorize**,
   tambahkan seller pengujian ke whitelist di App Console. Ini tidak berlaku
   identik untuk semua kategori app; ikuti policy yang tampil pada app Anda.

Jangan memberikan password seller ke ZETAS/Agent. Seller login dan consent hanya
dilakukan pada situs resmi Lazada di tab terpisah.

## Alur dan keamanan

- Login ZETAS → **Pengaturan → Koneksi Lazada → Hubungkan Lazada**.
- Browser membuka tab resmi Lazada; tab dibuka dari klik pengguna agar tidak
  terblokir sebagai popup atau gagal karena Lazada melarang embedding iframe.
- Authorization state acak disimpan sebagai hash, memiliki TTL 10 menit dan
  dikonsumsi atomik satu kali. Cookie browser pengikat bersifat HttpOnly/Secure/
  SameSite=Lax. State juga terikat pada user dan session yang memulai OAuth.
- Callback tidak bergantung pada cookie session SameSite=Strict yang mungkin
  tidak dikirim pada navigasi kembali dari Lazada. Session asli tetap diperiksa
  di PostgreSQL sebelum pertukaran code dan sebelum token disimpan; reset/logout/
  deactivation selama exchange tidak dapat memasang token.
- Code ditukar hanya di backend, kemudian GetSeller diverifikasi. Access token
  dan refresh token disimpan sebagai satu ciphertext **AES-256-GCM**, dengan IV
  acak dan AAD yang mengikat user serta App Key/negara.
- Koneksi **privat per akun ZETAS**, walaupun order aplikasi yang sudah ada
  bersifat shared. Tidak ada role admin integrasi; satu operator tidak boleh
  mengganti/membaca credential operator lain.
- App Secret/access token/refresh token tidak dikirim ke frontend. App Key
  adalah client ID publik yang memang diperlukan pada URL resmi OAuth.
- Respons hanya metadata aman dan pesan error terbatas. Query callback tidak
  dicatat oleh logger aplikasi; raw provider response/exception juga tidak
  dicatat. Contoh reverse proxy menghindari log callback; terapkan kebijakan
  yang sama pada TLS proxy/CDN lain.
- Status Terhubung adalah hasil verifikasi terakhir dan token belum expired.
  **Cek koneksi** melakukan pemeriksaan API baru; polling status/focus/reload
  hanya membaca metadata lokal, tidak memanggil Lazada.
- Token expired/revoked atau check gagal → Tidak Terhubung. Untuk expiry,
  lakukan otorisasi ulang, bukan auto-refresh.

## Endpoint

| Endpoint | Proteksi / fungsi |
| --- | --- |
| `GET /api/lazada/connection` | Session, status cached privat |
| `POST /api/lazada/oauth/authorize` | Session + Origin + CSRF + HTTPS |
| `GET /api/lazada/oauth/callback` | HTTPS + state sekali pakai + browser binding + session asli aktif |
| `POST /api/lazada/check` | Session + Origin + CSRF; hanya GetSeller |

Tidak ada endpoint token publik atau endpoint order Lazada.

## Pengujian dan batas hasil

Verifikasi lokal: typecheck dan build frontend/backend berhasil; **38 test lulus**,
termasuk 11 test/subtest Lazada dengan provider simulasi. Pemeriksaan bundle
frontend tidak menemukan konfigurasi secret backend atau token fixture.
Pemeriksaan browser setelah login tidak selesai karena gangguan infrastruktur
pengujian; jangan menyatakannya lulus. Preview dan server dipulihkan setelahnya.

`tests/lazada.test.mjs` menguji signing dengan contoh dokumentasi resmi, konfigurasi
fail-closed, AES/tampering, backend/PostgreSQL nyata dengan **simulasi provider**
di child process terpisah, state/browser/CSRF, replay dan callback konkuren,
revocation saat exchange, expiry, negara, permission/outage, isolasi akun,
ciphertext, DTO dan sanitasi log. Simulasi tidak dimuat oleh aplikasi production.

**OAuth dan API Testing Lazada nyata belum diverifikasi**: credential privat tidak
disediakan. Jangan menyebut tes simulasi sebagai OAuth seller/API Lazada yang
berhasil. Untuk pengujian nyata setelah konfigurasi:

1. Login ZETAS, klik Hubungkan Lazada, login seller pengujian dan consent.
2. Pastikan callback kembali ke Pengaturan, status Terhubung.
3. Klik Cek koneksi; pastikan keberhasilan baru dan waktu pemeriksaan berubah.
4. Periksa tidak ada credential/token di respons browser, storage browser,
   source Git, atau log. Jangan menyalin nilai token saat pemeriksaan.
5. Tolak consent/revoke izin lalu periksa status/error, tanpa memanggil order API.

## Sumber resmi

- [Seller authorization & Testing policy](https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10533)
- [GenerateAccessToken](https://open.lazada.com/apps/doc/api?path=%2Fauth%2Ftoken%2Fcreate)
- [GetSeller](https://open.lazada.com/apps/doc/api?path=%2Fseller%2Fget)
- [Signature algorithm](https://open.lazada.com/apps/doc/doc?docId=108068&nodeId=10450)
- [HTTP request signing example](https://open.lazada.com/apps/doc/doc?docId=108069&nodeId=10451)