---
name: Aplikasi Lazada pengguna
description: Jenis dan status aplikasi di Lazada Open Platform yang dikonfirmasi pengguna
---

Pengguna telah membuat Seller In-house APP di Lazada dengan status Testing.

In-house IM Chat menggunakan aplikasi Lazada dan App Key/App Secret yang berbeda dari Seller In-house APP. Token, state OAuth, dan koneksinya harus tetap terpisah; callback URL yang sama dapat dipakai untuk keduanya.

**Why:** Pengguna menyatakan jenis dan status aplikasi ini saat menyiapkan credential integrasi.

**How to apply:** Gunakan kredensial dan token app IM hanya untuk IM Chat, jangan mengganti atau memakai token Seller. Jangan menganggap flag Testing lokal membuktikan status terbaru di Lazada; ikuti konfirmasi pengguna jika statusnya berubah.