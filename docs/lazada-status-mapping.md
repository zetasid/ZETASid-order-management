# Mapping status Lazada → kelompok ZETAS

Sumber resmi: [Order Status Flow](https://open.lazada.com/apps/doc/doc?docId=120167&nodeId=29484),
[diagram resmi](https://tida.alicdn.com/oss_1673492542466_null_WOkaxWKx.png),
dan daftar alias status [GetOrders](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fget).
Diagram menempatkan `confirmed` setelah `delivered`, bukan sebelum pemrosesan.

| Status API asli | Kelompok ZETAS |
|---|---|
| `unpaid`, `pending` | Menunggu (`pending`) |
| `repacked`, `packed`, `ready_to_ship_pending`, `ready_to_ship`, `to_pack`, `topack` | Dikemas / Diproses (`processing`) |
| `shipped`, `toship`, `to_ship`, `shipping` (alias GetOrders) | Dikirim / Diproses (`processing`) |
| `delivered`, `confirmed` | Selesai (`completed`) |
| `canceled`, `cancelled` | Dibatalkan (`cancelled`) |
| Kosong atau status lain yang belum dipetakan | Tidak diasumsikan; hanya masuk Semua (`null`) |

GetOrderItems `status` adalah sumber utama untuk item dan pengelompokan tahap
proses order. Header GetOrders `statuses` hanya digunakan untuk pengelompokan
tahap proses ketika belum ada item.
Order lama tanpa snapshot Lazada mempertahankan status lamanya.
Status mentah tetap tersimpan dan menjadi sumber label UI; status yang dikenal
ditampilkan sebagai label Indonesia (misalnya `packed` → “Dikemas”), sedangkan
nilai yang belum dikenal tidak ditebak dan tetap dapat diperiksa.

## Status pembayaran dan pengiriman digital

Status pembayaran dipisahkan dari tahap proses item. Nilainya berasal dari
header Lazada `GetOrders.statuses` (atau `GetOrder.statuses` saat pengecekan
langsung sebelum pengiriman), bukan dari enum lokal atau status item.

| Status header Lazada | Status pembayaran ZETAS |
|---|---|
| `unpaid` | Belum dibayar |
| `pending` | Menunggu konfirmasi |
| `canceled` | Dibatalkan |
| Status yang dipetakan ke `processing` atau `completed` | Dikonfirmasi/dibayar |
| Kosong, `null`, atau nilai yang tidak dipetakan | Tidak diketahui; tidak memenuhi syarat |

Pendapatan hanya menghitung status pembayaran Dikonfirmasi/dibayar. Endpoint
pengiriman digital juga mengambil status terbaru dari Lazada dan hanya dapat
melanjutkan ketika pembayaran dikonfirmasi serta item masih berada pada tahap
proses yang dapat dikirim. Status pembayaran Dikonfirmasi tidak mengubah status
item menjadi Selesai dan tidak dianggap sebagai bukti bahwa digital sudah
dikirim. Status item yang tidak dikenal, dibatalkan, atau bukan Menunggu tetap
tidak memenuhi syarat.

Untuk beberapa item: semuanya batal → Dibatalkan; semua item selain yang batal
sudah selesai → Selesai; ada item Diproses atau campuran selesai/menunggu →
Diproses; sisanya Menunggu. Satu status tidak dikenal membuat kelompok order
belum dipetakan, bukan diam-diam Menunggu.

Daftar, filter, detail, dan ringkasan memproyeksikan snapshot yang tersimpan;
tidak ada backfill atau perubahan schema untuk memperbaiki tampilan. Jika
pengguna menjalankan “Baca pesanan”, sinkronisasi baca-saja meminta rentang
`update_after`/`update_before`, sehingga pesanan lama yang berubah di Lazada
dapat diperbarui dari snapshot provider terbaru. Ini tidak menjalankan
DeliverDigital.

Pengujian snapshot nyata: 28 order / 28 item, `confirmed` 11 dan `canceled` 17.
Tes membandingkan fingerprint seluruh row order/item sebelum dan setelah
pembacaan, termasuk nilai status tersimpan dan timestamps.