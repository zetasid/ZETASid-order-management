# Mapping status Lazada → kelompok ZETAS

Sumber resmi: [Order Status Flow](https://open.lazada.com/apps/doc/doc?docId=120167&nodeId=29484),
[diagram resmi](https://tida.alicdn.com/oss_1673492542466_null_WOkaxWKx.png),
daftar status [GetOrder](https://open.lazada.com/apps/doc/api?path=%2Forder%2Fget) dan alias
[GetOrders](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fget), serta field pembayaran
[GetOrderItems](https://open.lazada.com/apps/doc/api?path=%2Forders%2Fitems%2Fget).
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
proses order. Status header yang menunjukkan kemajuan, selesai, atau batal juga
menjadi sinyal workflow; header `pending` yang tertinggal tidak menimpa status
item yang lebih baru. Status workflow yang tidak dikenal membuat order tidak
memenuhi syarat pemrosesan. Order lama tanpa snapshot Lazada mempertahankan
status lamanya.
Status mentah tetap tersimpan dan menjadi sumber label UI; status yang dikenal
ditampilkan sebagai label Indonesia (misalnya `packed` → “Dikemas”), sedangkan
nilai yang belum dikenal tidak ditebak dan tetap dapat diperiksa.

## Status pembayaran dan pengiriman digital

Status pembayaran dipisahkan dari workflow. Dokumentasi GetOrder menyediakan
`statuses` (status item di order) dan `payment_method` (metode pembayaran),
bukan status pembayaran yang berhasil. GetOrderItems menyediakan
`payment_time` (waktu pembayaran dalam milidetik) serta `stage_pay_status`
untuk status pembayaran pesanan presale.

Konfirmasi pembayaran hanya diberikan jika setiap item memiliki
`payment_time` berupa timestamp milidetik yang valid, dan tidak ada
`stage_pay_status` yang belum lunas atau tidak dikenal. `unpaid` menjadi Belum
Dibayar; `unpaid final payment` tetap Menunggu. Jika waktu pembayaran kosong,
invalid, tidak tersedia pada salah satu item, atau status presale tidak dikenal,
status pembayaran Tidak diketahui dan pengiriman digital ditolak. Status
workflow `pending`, `to_pack`, `to_ship`, `shipped`, `delivered`, `confirmed`,
`canceled`, atau `cancelled` tidak pernah menjadi bukti pembayaran.

Pendapatan hanya menghitung pembayaran dengan bukti `payment_time` lengkap dan
workflow order yang memenuhi syarat (Diproses/Selesai). Endpoint pengiriman
digital juga membaca snapshot terbaru Lazada dan hanya dapat melanjutkan jika
pembayaran terkonfirmasi, workflow order masih Menunggu, semua item masih
Menunggu, dan seluruh item secara eksplisit digital. Status pembayaran
Dikonfirmasi tidak mengubah status workflow dan bukan bukti bahwa digital
sudah dikirim.

Untuk beberapa item, status batal apa pun membuat order Dibatalkan; semua item
selesai menghasilkan Selesai; ada item Diproses atau campuran selesai/menunggu
menghasilkan Diproses; sisanya Menunggu. Satu status workflow tidak dikenal
membuat kelompok order belum dipetakan, bukan diam-diam Menunggu.

Daftar, filter, detail, dan ringkasan memproyeksikan snapshot yang tersimpan;
tidak ada backfill atau perubahan schema untuk memperbaiki tampilan. Jika
pengguna menjalankan “Baca pesanan”, sinkronisasi baca-saja meminta rentang
`update_after`/`update_before`, sehingga pesanan lama yang berubah di Lazada
dapat diperbarui dari snapshot provider terbaru. Ini tidak menjalankan
DeliverDigital.

Pengujian snapshot: status pembayaran diuji terpisah dari workflow, termasuk
timestamp pembayaran yang valid/tidak valid, presale yang belum lunas, serta
header workflow yang maju ketika item masih Menunggu.
Tes membandingkan fingerprint seluruh row order/item sebelum dan setelah
pembacaan, termasuk nilai status tersimpan dan timestamps.