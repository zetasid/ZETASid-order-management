# Database ZETAS.id — fase 2

## Model

| Tabel | Fungsi dan kolom utama |
| --- | --- |
| `users` | UUID `id`, `email` unik, `display_name`, `external_auth_id` unik opsional, `password_hash` nullable untuk profil lama, `is_active`, `created_at`, `updated_at`. Login lokal ditambahkan pada fase 4 tanpa password default. |
| `orders` | UUID `id`, `lazada_order_id` unik dan wajib, `status`, `created_at`, `updated_at`. |
| `order_items` | UUID `id`, `lazada_order_item_id` unik dan wajib, UUID `order_id`, `product_name`, JSONB `digital_detail`, `status`, `created_at`, `updated_at`. |
| `sync_logs` | UUID `id`, `source`, `status`, `records_count`, `message`, JSONB `metadata`, `started_at`, `finished_at`, `created_at`. Penyimpanan saja, tanpa worker sinkronisasi. |
| `system_logs` | UUID `id`, `level`, `message`, JSONB `context`, `created_at`. Penyimpanan saja, tanpa integrasi logging tambahan. |

ID Lazada memakai `text` untuk menjaga nilai identifier persis tanpa batas integer/JavaScript. ID internal memakai UUID. Unique constraint berlaku global per tabel, termasuk untuk item yang mencoba memakai ID yang sama di order lain. Identifier Lazada tidak boleh null atau hanya whitespace.

Satu `orders` memiliki banyak `order_items`. Foreign key `order_items.order_id` wajib dan terindeks. `ON DELETE RESTRICT` mencegah penghapusan order yang masih memiliki item; tidak ada cascade delete yang menghapus data item tanpa disadari.

Status order dan item memakai enum `pending`, `processing`, `completed`, `cancelled`. Fase 3 menambahkan hanya nilai enum `processing` untuk status Diproses melalui migration tambahan; nilai/data lama tetap utuh. JSONB `digital_detail` boleh null sampai detail digital tersedia; isi dapat berupa objek sesuai produk tanpa mengubah schema. Jangan menyimpan credential, token, atau secret dalam detail maupun kolom metadata log.

Timestamp memakai `timestamptz`. Trigger PostgreSQL memperbarui `updated_at` pada `users`, `orders`, dan `order_items`, termasuk penulisan melalui SQL langsung. `created_at` tidak diubah oleh trigger.

## Kompatibilitas dan preservasi data

Migration awal tidak diubah. Migration fase 2:

1. Menambahkan empat tabel, foreign key, indeks, constraint, dan timestamp trigger.
2. Menambahkan `orders.lazada_order_id` sebagai nullable sementara.
3. Menyalin nilai `marketplace_order_id` lama **tanpa mengubah nilai aslinya**.
4. Memasang NOT NULL, unique constraint, dan pengecekan ID tidak kosong.

Drizzle menjalankan migration dalam transaksi PostgreSQL. ID lama kosong/invalid menyebabkan kegagalan dan rollback, bukan penghapusan atau perbaikan data diam-diam. Perbaiki data invalid secara terkontrol sebelum mencoba lagi.

Kolom header lama `marketplace_order_id`, `product_name`, `buyer_name`, dan `amount` tetap disimpan untuk mempertahankan seluruh data yang sudah ada. Identifier lama sekarang opsional; penulisan baru memakai `lazada_order_id`. API baca mempertahankan nama field `marketplaceOrderId`, tetapi mengambil nilainya dari identifier kanonis tersebut. Fase 3 menambahkan `lazadaOrderId`, `updatedAt`, dan seluruh `items` ke respons; produk diambil dari item, dengan header lama sebagai sumber hanya bila item belum tersedia. Digital Detail dibaca dari JSONB: string ditampilkan persis, objek/JSON terstruktur diserialisasi dengan indentasi untuk ditampilkan dan disalin.

Produk header lama tidak diubah menjadi item fiktif: ID Lazada item tidak tersedia pada data fase awal, sehingga tidak boleh dibuat secara sembarang. Tidak ada data order, item, user, atau log contoh yang ditambahkan oleh migration.

Jangan menghapus kolom legacy atau migration yang telah diterapkan pada pengembangan berikutnya tanpa rencana migrasi data dan persetujuan terpisah.

Fase 4 menambah `auth_sessions` (HMAC token, relasi user, waktu dibuat/kedaluwarsa) dan `auth_login_buckets` (key HMAC, jumlah percobaan, waktu reset), serta dua kolom pengguna. Migration additive tidak mengubah tabel/data pesanan maupun profil lama. Foreign key session memakai cascade hanya untuk data autentikasi sementara saat user dihapus; relasi order–item tetap RESTRICT. Rincian ada di `docs/security.md`.

## Menjalankan dan menguji

```sh
pnpm --filter @workspace/db run migrate
pnpm run test:db
# Dengan frontend dan API berjalan:
pnpm test
```

Tes database memutar ulang SQL migration asli dalam schema acak, memakai transaksi, lalu rollback. Tes mencakup upgrade dengan data lama, unique constraint, relasi satu-ke-banyak, penolakan orphan item/penghapusan parent, timestamp trigger, data JSONB, constraint log, dan rollback migration yang gagal.

Tes fondasi tetap menguji API, detail order nyata, dan migration ulang melalui runner yang sama dengan Compose. Fixture publiknya dibersihkan hanya berdasarkan UUID milik tes.

Deployment Compose tetap memakai service `migrate` sebelum API dan volume PostgreSQL yang sama. Tidak ada reset/drop otomatis. Lihat `README.md` untuk prosedur update dan backup.