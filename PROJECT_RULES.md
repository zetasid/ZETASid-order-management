# Project Rules

Aturan ini membantu menjaga konsistensi, keamanan, dan keutuhan data ZETAS.id. Periksa implementasi terbaru sebelum mengikuti uraian fase lama.

## Source of truth dan scope

- Untuk perilaku yang sudah ada, utamakan source, schema, test, dan workflow terkini daripada README atau dokumen berfase lama.
- Bedakan dengan jelas `IMPLEMENTED`, `PLANNED`, `NOT IMPLEMENTED`, dan `UNKNOWN`. Jangan menyimpulkan status live Lazada/hosting hanya dari konfigurasi repository.
- Jangan menambah fitur, provider, mode production Lazada, atau perubahan auth/security tanpa permintaan yang jelas.
- Jangan menyatakan UI Pesanan, Detail Pesanan, Dashboard, atau Pengaturan belum dibuat: route/view sudah ada. Roadmap lanjutan tiap area belum ditetapkan oleh codebase.

## Data dan status order

- Perlakukan PostgreSQL dan snapshot provider sebagai persistence utama. Jaga order/item IDs, relasi, timestamp, dan Digital Detail yang tersimpan.
- Migration baru harus incremental, ditinjau sebelum dijalankan, dan mempertahankan data. Jangan edit/hapus migration yang sudah diterapkan; jangan menghapus volume/database untuk memecahkan masalah migration.
- Simpan status provider asli. Kelompok status ZETAS adalah proyeksi read-only dan harus konsisten pada daftar, detail, filter, serta summary.
- Status Lazada yang tidak dikenal atau tidak cukup lengkap harus tetap tidak terpetakan; jangan memetakannya diam-diam ke Menunggu.
- Jangan melakukan resync/backfill atau mengubah status tersimpan hanya untuk memperbaiki kelompok tampilan.
- Digital Detail hanya berasal dari `digital_delivery_info`; jangan menebak dari `extra_attributes` atau field lain.
- Data order yang dibaca di aplikasi saat ini adalah workspace bersama. Jangan mengklaim isolasi data per user tanpa perubahan dan bukti implementasi.

## Batas operasi Lazada

- Mode aplikasi adalah Lazada Testing. Pertahankan persyaratan HTTPS, validasi payload/response, izin minimal, dan perlindungan callback OAuth.
- API country seller dan webhook site adalah identitas yang berbeda. Jangan mengganti country supaya menyamai site push, atau memperluas allowlist site, tanpa bukti dan permintaan eksplisit.
- Manual order sync dan background push/reconciliation hanya membaca data Lazada (`GetOrders`, `GetOrder`, `GetOrderItems`, `GetUpdatedOrders`).
- DeliverDigital hanya boleh dipicu aksi operator yang eksplisit, pada order/item yang memenuhi guard. Jangan memindahkannya ke polling, retry worker, webhook, atau startup.
- Jangan menganggap hasil DeliverDigital berhasil sampai status provider terverifikasi. Untuk hasil yang tidak pasti, pertahankan jejak unresolved dan jangan mendorong operator melakukan retry buta.
- Push harus memverifikasi signature dari byte body yang tepat sebelum parse; pertahankan validasi timestamp, site/schema, deduplication, durable ACK, dan respons aman. Jangan membuat jalur Verify/bypass berdasarkan contoh payload yang belum terbukti.

## Akun, session, dan secret

- Login menggunakan auth lokal PostgreSQL; jangan menggantinya dengan Clerk atau provider lain tanpa permintaan pengguna.
- Pertahankan session server-side 30 hari yang diperpanjang saat aktivitas, logout, pencabutan saat reset/nonaktif, same-origin, CSRF untuk mutasi, cookie aman, dan pembatasan brute-force.
- Akun hanya diprovision oleh operator melalui script terpercaya. Jangan menambahkan registrasi publik atau menaruh provisioning di endpoint HTTP.
- Jangan mencetak atau menyimpan nilai API key, token, password, session secret, connection string, atau payload berisi credential. Gunakan fasilitas secrets/environment privat. Variabel `VITE_*` masuk ke browser bundle dan tidak boleh berisi secret.
- Jangan melonggarkan `TRUST_PROXY` ke semua alamat/hop. Percayai forwarded headers hanya dari proxy yang dikenal dan dikonfigurasi untuk menimpa header klien.
- Pertahankan log yang menghilangkan query string, cookie, raw body, token, dan detail rahasia. Error eksternal ke browser harus generik dan bebas credential.

## Kontrak, test, dan perubahan

- Jika API berubah, perbarui kontrak OpenAPI terlebih dahulu, lalu jalankan codegen Orval dan typecheck agar client serta validator sejalan.
- Jalankan pemeriksaan yang relevan: `pnpm run typecheck`, `pnpm test:db`, `pnpm test`, dan/atau `pnpm run build`. Test integrasi menggunakan PostgreSQL disposable, bukan database operasional.
- Untuk status order, auth, OAuth, signature push, retry, migration, dan pengiriman digital, tambahkan atau pertahankan test positif serta negatif yang memverifikasi guard terkait benar-benar berjalan.
- Jangan menganggap test yang hanya memperoleh 401/403 membuktikan guard khusus yang dimaksud telah diuji; pastikan prasyarat dan checkpoint yang dapat diamati.
- Pertahankan pnpm workspace dan lockfile. Periksa hasil build/typecheck setelah perubahan package atau generated client.
- Sebelum menyerahkan perubahan, tinjau `git diff --check`, daftar file berubah, dan hasil scan secret tanpa menampilkan nilai sensitif.

## Infrastruktur

- Compose adalah opsi self-host. Database/API tetap private; Nginx web menjadi reverse proxy, dengan TLS tepercaya di depan untuk akses production.
- Workflow CI menguji/build; workflow GHCR menerbitkan image. Jangan menyebutnya deployment host otomatis.
- Jangan menjalankan `docker compose down -v`, menghapus volume, atau melakukan restore/reset database sebagai langkah update biasa.
- Jangan membuat klaim tentang domain publik, certificate, app-console activation, atau deployment yang tidak diverifikasi secara independen.
