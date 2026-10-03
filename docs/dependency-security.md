# Perbaikan dependency development tooling

Pemeriksaan: 2026-10-03. Tidak ada advisory yang di-ignore, tidak ada downgrade,
dan tidak ada perubahan source frontend/backend atau output client API.

## Hasil sebelum dan sesudah

| Severity | Sebelum | Sesudah |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 3 | 1 |
| Moderate | 2 | 0 |
| Low / Info | 0 | 0 |

Audit production tetap bersih. Audit penuh **belum bersih** karena satu HIGH
belum memiliki patch upstream; `pnpm audit` tetap memberikan exit code nonzero.

## Perubahan aman

- **Orval 8.30.0 → 8.39.0**, masih major 8 dan mendukung Node >=22.18; proyek
  memakai Node 24. Upgrade upstream menghapus jalur transitif tooling dokumentasi
  `typedoc → minimatch → brace-expansion 5.0.9` dari dependency yang terpasang.
  Ketiga advisory pada brace-expansion teratasi tanpa menyembunyikan temuan:
  - HIGH [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7)
  - HIGH [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)
  - MODERATE [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)
  Konfigurasi generator menetapkan React Query v5 secara eksplisit agar versi
  terbaru Orval tidak melakukan fallback ke tipe v4 ketika peer tidak tercantum
  pada package `api-spec`. Ini mempertahankan major API frontend yang sudah dipakai.
- **fast-uri 3.1.7 → 3.1.8** untuk
  [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj)
  (MODERATE). AJV terbaru, 8.20.0, masih mendeklarasikan `fast-uri ^3.0.1`, sehingga
  parent upgrade saja tidak menetapkan batas patched. Override sempit
  `ajv>fast-uri: 3.1.8` di `pnpm-workspace.yaml` menggunakan versi patched
  **dalam range major 3 yang didukung AJV**, bukan memaksakan fast-uri major 4.

Minimum release age, package firewall, dan daftar native Linux AMD64/ARM64 tetap
dipertahankan. Lockfile serta dependency yang benar-benar terpasang diverifikasi,
bukan hanya mengubah deklarasi versi.

## Satu HIGH tersisa — bukan diabaikan

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):
`braces 3.0.3`, stack-exhaustion DoS saat menerima pola bersarang sangat dalam.

Jalur: `artifacts/mockup-sandbox → fast-glob 3.3.3 → micromatch 4.0.8 → braces 3.0.3`.
Registry dan advisory diperiksa: ketiganya masih versi latest, dan belum ada
versi patched untuk braces. Memaksa versi berbeda, downgrade, atau ignore ID
advisory tidak memperbaiki masalah.

Temuan berada pada **tooling preview Canvas**, bukan dependency API production.
Pemakaian sekarang hanya memindai pola TSX konstan dengan exclusion konstan;
tidak menerima pola glob dari request pengguna. Ini membatasi paparan yang
terlihat, tetapi bukan alasan menyatakan package bebas vulnerability.
Jangan memperluas tooling tersebut untuk memproses pola dari pihak tidak
dipercaya. Directory Canvas juga dikecualikan dari Docker build context.

Tanpa patch upstream, solusi menyeluruh memerlukan penggantian glob engine
atau implementasi penemuan file. Itu bukan upgrade dependency yang setara:
semantik matching, hidden files, symlink, exclusion dan refresh preview harus
ditinjau serta diuji. Penggantian tersebut **tidak dipaksakan** dalam perbaikan ini
agar fungsi aplikasi/tooling tidak berubah. Temuan tetap tercatat dalam audit
dan laporan GitHub Actions; kebijakan nonblocking untuk laporan dev tooling
tidak diubah.

## Pemeriksaan tambahan

Pemindaian statis juga menandai dua temuan MEDIUM, terpisah dari lima advisory
dependency: URL PostgreSQL dummy untuk validasi Compose dan perpanjangan cookie
session. URL tersebut hanya fixture CI tanpa credential production. Cookie yang
diperpanjang sudah cocok dengan HMAC session tersimpan, user aktif, dan batas
waktu; login merotasi token acak. Temuan sudah ditinjau dan tidak disembunyikan
dengan pengecualian scanner. Pemindaian dataflow tidak melaporkan temuan.

## Verifikasi

```sh
pnpm audit
pnpm audit --prod
pnpm run typecheck
PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/zetas-id run build
pnpm --filter @workspace/api-server run build
pnpm test
```

Gunakan PostgreSQL disposable dan secret session tes acak untuk suite integrasi,
seperti panduan `docs/ci.md`. Codegen Orval diverifikasi pada direktori sementara
agar client/validator aplikasi yang sudah ada tidak diubah.