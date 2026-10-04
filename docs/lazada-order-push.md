# Lazada order PUSH — ZETAS

## Batas fitur

Memakai koneksi OAuth Seller In-house yang sudah ada. Tidak ada koneksi baru,
perubahan OAuth, DeliverDigital, perubahan status di Lazada, fulfillment,
auto-processing, Digiflazz, Telegram, payment, atau upload foto.

## Endpoint

`POST /api/lazada/orders/push`

- HTTPS wajib; request JSON mentah maksimal 16 KiB, tanpa compression.
- Header `Authorization` adalah hex HMAC-SHA256 dari **AppKey + body mentah**,
  menggunakan AppSecret. Verifikasi constant-time, sebelum payload dipercaya.
- Hanya Order Status Change (`message_type: 0`), site negara yang dikonfigurasi,
  serta ID/timestamp/field resmi yang valid.
- Timestamp baru harus dalam 7 jam terakhir atau paling jauh 5 menit ke depan.
  Rentang ini mencakup retry LPM setiap 30 menit hingga 12 kali.
- Identitas event menyertakan app/seller/site/order/line/status/waktu perubahan;
  timestamp pengiriman dan formatting JSON tidak menyebabkan duplikasi.
- Rate limit persisten: 120 request/menit/IP. Error quota: 429 dan Retry-After.
- 200 hanya setelah event diterima secara durable di PostgreSQL, atau ketika
  event yang sama sudah tersimpan. Tidak ada fetch API pada jalur ACK.
- Jalur ACK tidak mengunci baris monitoring yang dapat dikunci worker saat
  menunggu API; tes juga memeriksa ACK <500 ms ketika rekonsiliasi lambat.
- Tanpa session browser/CSRF; autentikasi webhook adalah signature Lazada.
  Endpoint status monitoring tetap memerlukan session pengguna.

Antrean menyimpan ID/hash/timing/attempt/safe error code, bukan payload mentah,
credential, Digital Detail, atau data customer.

## Pemrosesan dan recovery

Worker memeriksa antrean lokal setiap 5 detik. Untuk push yang sah, hanya
`/order/get` dan `/order/items/get` yang dipanggil. Data API, bukan payload push,
menjadi sumber order, item, Digital Detail, dan status.

Unique ID order/item dan transaksi/savepoint melindungi seluruh upsert,
penyelesaian event, dan monitoring. Data provider yang identik tidak menulis
ulang row. Data yang berubah memperbarui row yang sama. Item tidak dapat pindah
ke order lain. Tidak ada penghapusan order/item existing.

Kegagalan API, data parsial, token tidak valid, atau kegagalan penulisan
menyisakan event pending. Retry eksponensial mulai 30 detik hingga maksimum
6 jam; antrean tetap ada setelah restart. Advisory lock yang sama dengan
sinkronisasi manual mencegah dua importer menulis bersamaan.

Backup berjalan setiap 6 jam, memakai GetOrders `update_after`, `update_before`,
`sort_by=updated_at` dan GetOrderItems. Awalnya membaca 7 hari terakhir;
selanjutnya memakai watermark dengan overlap 10 menit. Halaman maksimum
20 order, window/cursor tersimpan, tidak maju ketika halaman gagal. Retry
halaman gagal setelah 5 menit. Tombol **Baca order Lazada** tetap tersedia.

Digital Detail hanya diambil dari **digital_delivery_info**, termasuk nilai
JSON terstruktur. Nilai tidak dicatat di log. Mapping tetap:

| Sumber Lazada | Kelompok lokal |
|---|---|
| unpaid, pending | Menunggu |
| repacked, packed, ready_to_ship_pending, ready_to_ship, shipped, topack, toship, shipping | Diproses |
| delivered, confirmed | Selesai |
| canceled | Dibatalkan |

Tidak ada tebakan status yang tidak dikenal atau pemrosesan fulfillment.

## Monitoring dan UI

Pengaturan menampilkan Terhubung, Push Order, Last Push, Last Sync, Last Error,
jumlah antrean, dan jadwal backup. Status dibaca lewat
`GET /api/lazada/orders/push-status`.

- Aktif berarti push bertanda tangan berhasil memicu pembacaan API dan
  koneksi masih valid. Ini **bukan** bukti subscription App Console aktif.
- Last Push adalah waktu penerimaan event unik terakhir; retry duplikat tidak
  menulis ulang receipt. Pesan self-test saja tidak membuktikan order nyata.
- Last Error menggunakan kode aman, termasuk kegagalan event yang masih pending.
- Daftar Pesanan membaca ulang API lokal setiap 5 detik, tanpa fetch Lazada
  dari browser. Pencarian/filter tetap dapat digunakan.

## Cara mengaktifkan di Lazada

1. Publish backend + frontend dengan domain HTTPS stabil. Untuk worker/timer,
   gunakan **Reserved VM / always-running**, bukan Static atau Autoscale yang
   dapat berhenti saat idle. Jika memakai host lain, jalankan service terus
   menerus. Migrasi database tambahan harus diterapkan di database target.
2. Di **aplikasi Seller In-house yang sama**, pastikan permission baca GetOrder,
   GetOrderItems, GetOrders aktif. Jangan membuat aplikasi/koneksi OAuth baru.
3. Buka **App Console → Message Service**. Isi callback dengan domain publik
   tersebut + `/api/lazada/orders/push`. Ini berbeda dari callback OAuth;
   **jangan mengganti callback OAuth yang sudah berjalan**.
4. Klik **Verify**, periksa hasilnya. Dokumentasi LPM mencantumkan sertifikat
   CA OV/EV, bukan DV/self-signed. URL publik Replit belum dibuktikan diterima
   oleh verifikasi Lazada; gunakan endpoint/domain dengan sertifikat yang
   diterima Lazada bila Verify menolaknya.
5. Setelah Verify berhasil, subscribe **Order Status Change (message_type 0)**,
   lalu klik **Save**. Pastikan izin/store untuk aplikasi Testing sesuai.
6. Tunggu order nyata baru. Cocokkan receipt signed push, fetch API sukses, row
   unik tersimpan, dan kemunculan otomatis di Pesanan tanpa tombol sync.
   Pesan Verify dan data test bukan bukti order nyata masuk otomatis.

Production belum dipublish ketika implementasi diverifikasi. Tidak ada URL
production, subscription yang terbukti, atau genuine new-order PUSH yang dapat
dilaporkan aktif. Last Sync backup yang berhasil bukan bukti PUSH.

## Verifikasi

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run build
node --test --test-force-exit --test-concurrency=1 tests/lazada-push.test.mjs
```

10 checks lulus (parent + 9 subtests): signature/raw bytes, invalid payload,
HTTPS/replay/auth, ACK durable, duplicate, order baru/multiple items/digital,
existing update/no-op, failed fetch/retry/atomic rollback, missed-push backup,
manual fallback/rate limit/no provider writes/no sensitive logs, serta ACK saat
worker lambat. Provider simulasi hanya dipasang di proses Node test disposable.
Data fixture/session/connection/queue dibersihkan; fingerprint order dan item
existing tidak berubah akibat tes. Dua regresi status lama juga lulus.

Browser 402px membuktikan monitoring yang benar serta satu fixture UI-only
muncul/hilang otomatis melalui polling, tanpa refresh atau navigation. Fixture
dan session sudah dibersihkan. Tidak ada browser API mocking. Ini bukan bukti
push order Lazada nyata.

## Referensi

- [LPM overview resmi](https://open.lazada.com/apps/doc/doc?nodeId=29524&docId=120168&lang=en_US)
- [Dokumentasi pesan order resmi](https://open.lazada.com/apps/doc/doc?nodeId=29537&docId=120196&lang=en_US)
- [Salinan dokumentasi dengan tautan sumber resmi](https://raw.githubusercontent.com/xKeNcHii/lazada-sdk/main/docs/guides/push-mechanism-webhook-application.md)
- [Jenis publishing Replit](https://docs.replit.com/features/publishing/deployment-types)