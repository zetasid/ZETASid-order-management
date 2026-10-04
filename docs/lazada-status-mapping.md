# Mapping status Lazada → kelompok ZETAS

Sumber resmi: [Order Status Flow](https://open.lazada.com/apps/doc/doc?docId=120167&nodeId=29484),
[diagram resmi](https://tida.alicdn.com/oss_1673492542466_null_WOkaxWKx.png),
dan daftar alias status [GetOrders](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fget).
Diagram menempatkan `confirmed` setelah `delivered`, bukan sebelum pemrosesan.

| Status API asli | Kelompok ZETAS |
|---|---|
| `unpaid`, `pending` | Menunggu (`pending`) |
| `repacked`, `packed`, `ready_to_ship_pending`, `ready_to_ship`, `shipped` | Diproses (`processing`) |
| `topack`, `toship`, `shipping` (alias GetOrders) | Diproses (`processing`) |
| `delivered`, `confirmed` | Selesai (`completed`) |
| `canceled` | Dibatalkan (`cancelled`) |
| Kosong atau status lain yang belum dipetakan | Tidak diasumsikan; hanya masuk Semua (`null`) |

GetOrderItems `status` adalah sumber utama untuk item dan pengelompokan order.
Header GetOrders `statuses` hanya digunakan ketika belum ada item.
Order lama tanpa snapshot Lazada mempertahankan status lamanya.
Status mentah tetap ditampilkan persis sebagaimana diterima API.

Untuk beberapa item: semuanya batal → Dibatalkan; semua item selain yang batal
sudah selesai → Selesai; ada item Diproses atau campuran selesai/menunggu →
Diproses; sisanya Menunggu. Satu status tidak dikenal membuat kelompok order
belum dipetakan, bukan diam-diam Menunggu.

Ini proyeksi baca untuk daftar, filter, detail, dan ringkasan. Tidak ada UPDATE
atau migrasi data tersimpan. Tidak menjalankan sinkronisasi atau DeliverDigital.
Pemetaan yang sama berlaku apabila pengguna kelak melakukan sinkronisasi manual.

Pengujian snapshot nyata: 28 order / 28 item, `confirmed` 11 dan `canceled` 17.
Tes membandingkan fingerprint seluruh row order/item sebelum dan setelah
pembacaan, termasuk nilai status tersimpan dan timestamps.