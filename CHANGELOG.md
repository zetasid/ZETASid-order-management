# Changelog

Milestone di bawah direkonstruksi dari tanggal dan subject Git yang ada, lalu dibatasi pada kemampuan yang juga terlihat pada source saat ini. Repository tidak memiliki release tag; tanggal bukan tanggal rilis produk.

## Unreleased

Perubahan pada working tree saat ini belum menjadi rilis. Status deployment eksternal tidak dapat ditentukan dari changelog.

## 2026-10-05

- Session auth dirapikan dengan cakupan test durasi. Implementasi aktif memakai masa berlaku 30 hari yang diperpanjang ketika ada aktivitas.
- Batas trust reverse proxy dan validasi keamanan Lazada push diperkuat; handler memverifikasi signature raw body dan hanya memberi ACK setelah receipt durable tersimpan.
- Integrasi order Lazada dan schema/client API dikembangkan.
- Aksi DeliverDigital manual ditambahkan; operator dan status provider tetap menjadi bagian dari guard serta konfirmasi hasil.

## 2026-10-04

- Integrasi Lazada dan tampilan/order mapping dikembangkan untuk data order/item dan status asli.
- Keamanan push Lazada dan test terkait ditambahkan/diperketat.
- Workflow terpisah untuk membangun dan menerbitkan image Docker ke GHCR ditambahkan.

## 2026-10-03

- API server, kontrak/client API, dan struktur package workspace ditata ulang.
- Schema PostgreSQL dan migration versioned dikembangkan bersama alur Dashboard/Pesanan.
- Login lokal dan alur auth web/API ditambahkan.
- Docker Compose, Nginx, migration runner, serta prosedur deployment/update disiapkan.
- GitHub Actions dan runner test/build/audit/container diperkenalkan.

## 2026-09-11

- Repository dimulai dengan commit `Initial commit`. Historical details not available in repository.

## Batas riwayat

- Tidak ada versi semantik atau release tag yang dapat dipakai untuk menyatakan rilis production.
- Subject sejumlah commit bersifat luas; rincian yang tidak dapat dikonfirmasi melalui source tidak dianggap sebagai milestone fitur.
- Keberhasilan CI tertentu, aktivasi Lazada Console, konektivitas publik webhook, dan deployment live tidak dapat dipastikan hanya dari riwayat lokal ini.
