# Fase 8 — pembacaan order Lazada

- Hanya manual: `POST /api/lazada/orders/sync`, wajib session, HTTPS, same-origin, dan CSRF.
- Provider hanya `GET /orders/get` (GetOrders) dan `GET /order/items/get` (GetOrderItems).
- Pilih rentang tanggal WIB di Pesanan. Default 90 hari; maksimum rentang 366 hari.
- Satu klik membaca maksimal 20 order dengan semua itemnya. Halaman berikutnya harus diklik sendiri.
- Upsert PostgreSQL berdasarkan ID asli, tanpa membuat item fiktif atau menghapus data lama.
- Seluruh halaman disimpan atomik setelah semua detail valid. Error tidak memasang data parsial.
- Key/token selalu digunakan di backend. Token tetap terenkripsi; raw payload, query provider, dan nilai customer tidak dicetak ke log.
- Nominal disimpan sebagai numeric(18,2), bukan pembulatan integer; harga mentah API juga dipertahankan. Migrasi mempertahankan nilai lama.
- Status Lazada asli ditampilkan; enum lokal lama hanya kelompok kompatibilitas untuk filter/dashboard.
- `digital_delivery_info` adalah field terdokumentasi GetOrderItems dan diamati di response nyata. Nilai string dipertahankan persis, tidak diparsing menjadi tujuan yang ditebak.
- `extra_attributes` ditampilkan terpisah sesuai nilai asli. Tidak diasumsikan sebagai Digital Detail.
- Field kosong/absen/null tidak diganti data buatan. Alamat/penerima tidak disimpan karena tidak dibutuhkan untuk tampilan fase ini.
- Tidak ada DeliverDigital, fulfillment, perubahan order di Lazada, auto-processing, refresh token otomatis, Telegram atau Digiflazz.

Dokumentasi provider:
- https://open.lazada.com/apps/doc/api?path=%2Forders%2Fget
- https://open.lazada.com/apps/doc/api?path=%2Forder%2Fitems%2Fget

Tes regresi: `node --test --test-concurrency=1 tests/lazada-orders.test.mjs`.
Fixture dummy hanya untuk tes terisolasi, bukan fallback production.