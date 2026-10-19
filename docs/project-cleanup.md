# Audit pembersihan proyek — 3 Oktober 2026

> **Pembaruan 18 Oktober 2026 — satu lokasi produksi.** Struktur multi-cabang dihapus seluruhnya: tabel dan kolom cabang, peran Owner Pusat, pemilih cabang, menu Cabang, ruang laporan per cabang, dan board semua cabang. Database dibangun dari `supabase/SETUP.sql`, yang sejak 19 Oktober 2026 disusun dari `supabase/schema/` (10 file bentuk akhir, menggantikan 34 migrasi historis). File `branch-migrations/`, `report-migrations/`, `pilot/`, `maintenance/`, `UPGRADE_BRANCHES.sql`, `SETUP_ONLINE.sql`, serta skrip `build-branch-upgrade`, `compact-database`, dan `report-scheduler` sudah dihapus; isinya tetap ada di riwayat git. Daftar di bawah adalah catatan audit 3 Oktober dan dapat menyebut file yang sudah tidak ada.

Audit mencakup route dan layout Next.js, komponen termasuk dynamic import, helper dan ekspor TypeScript, CSS, aset publik, dependensi npm, tes, CI, skrip operasional, dokumentasi, serta rantai migrasi Supabase. Panduan struktur proyek dan CSS dari versi Next.js terpasang dibaca sebelum perubahan.

## Yang dibersihkan

- `public/printex-logo.png` (893.402 byte) dan `public/batik-login.webp` (432.408 byte): tidak memiliki referensi dalam kode, tes, skrip, atau dokumentasi. UI saat ini memakai `printex-brand.jpeg` dan `batiklogin.jpeg`. Total aset dihapus: 1.325.810 byte.
- Lima aturan CSS lama untuk `brand-wordmark`, `brand-caption`, dan `login-intro-footer`: elemen tersebut tidak lagi dirender. Branding aktif menggunakan keluarga kelas `workspace-brand-*`.
- Enam belas ekspor internal dijadikan deklarasi lokal di delapan modul: tipe cabang, rute produksi, foto, input order, produktivitas, dan ringkasan laporan; komponen `BranchManagement`; konstanta tahap operator dan kompresi foto; helper ukuran foto dan tanggal laporan. Implementasinya tetap diperlukan di dalam modul, tetapi tidak ada pemakai ekspor di luar modul.
- Klaim dokumentasi lama tentang pemuatan dataset lengkap dan referensi desain sebagai sumber kebenaran diperbarui agar sesuai alur aktif.

## Yang tetap diperlukan

Semua dependensi produksi memiliki pemakai. Dependensi pengembangan mendukung build, lint, TypeScript, tes database PGlite, tes browser Playwright, dan Tailwind.

Tidak ditemukan modul aplikasi yang sepenuhnya tidak terpakai setelah mempertimbangkan entry point Next.js, import biasa, dan dynamic import. Fungsi `transitionEvents`, `finishArchivedOrder`, dan `getStockShortcuts` tetap dipakai oleh tes perilaku atau kompatibilitas.

Migrasi dasar, migrasi cabang, SQL hasil generator, dan setup pilot tetap dibutuhkan untuk instalasi, upgrade, serta tes skema lama. Skrip demo mingguan/bulanan, reset 20 order, provisioning akun, audit, aktivasi, scheduler laporan, dan compaction merupakan alat operasional yang dijalankan manual; tidak adanya import aplikasi bukan bukti bahwa alat tersebut tidak dipakai.

Referensi desain awal tetap disimpan sebagai konteks bisnis, dengan penanda bahwa implementasi sekarang dapat berbeda. Backup, kredensial, artefak yang diabaikan Git, dan data database tidak dihapus. Perubahan lokal yang sudah ada sebelum audit dipertahankan.

## Pemeriksaan

`npm run check` berhasil: paket migrasi sesuai sumber, ESLint tanpa error, TypeScript lolos, seluruh 167 tes lulus tanpa skip, dan build produksi berhasil menghasilkan seluruh route. Pemeriksaan awal juga menjalankan TypeScript dengan `--noUnusedLocals --noUnusedParameters` tanpa temuan. ESLint masih memiliki satu warning navigasi pada `src/components/layout/online-status.tsx`, yang sudah ada sebelum pembersihan.

# Pembersihan file uji coba — 14 Oktober 2026

Komponen dikelompokkan per fitur (`ui/`, `orders/`, `production/`, `reports/`, `settings/`, `layout/`), dan referensi desain dipindah ke `docs/reference/`.

## Dihapus (tersedia di riwayat git, commit `0fc26c9`)

- Data demo/simulasi: `supabase/RESET_20_ORDERS.sql`, `RESET_DEMO_WEEK.sql`, `RESET_DEMO_MONTH.sql`, `scripts/execute-demo-*.mjs`, `verify-demo-*.mjs`, `verify-live-demo-month.mjs`, `lib/validate-demo-month.mjs`, `add-demo-photos.mjs`, `docs/demo-month-checklist.md`.
- Aktivasi sekali jalan yang sudah dieksekusi di produksi (1–2 Oktober 2026): `activate-scoped-loading`, `verify-scoped-loading`, `activate-compact-transitions`, `activate-daily-summaries`, `remove-unused-archive-history`. Migrasinya tetap ada dan termasuk dalam `UPGRADE_BRANCHES.sql`.
- Alat pilot/one-off: `create-pilot-accounts`, `provision-official-accounts`, `check-supabase` (skema lama), `audit-order-residue`, serta `supabase/REPAIR_ARCHIVE_PHOTOS.sql` (cukup jalankan ulang migrasi 0015, 0016, 0019).
- Dua tes yang hanya menguji file reset/repair tersebut.

## Dipertahankan

Semua migrasi (`migrations/`, `branch-migrations/`, `report-migrations/`), `UPGRADE_BRANCHES.sql`, `SETUP_ONLINE.sql` + `ACTIVATE_ADMIN.sql` (jalur instalasi), `pilot/` (dipakai tes untuk mereproduksi riwayat skema produksi sebelum menguji upgrade), `jobs/`, `maintenance/`, dan skrip `build-branch-upgrade`, `audit-database-size`, `compact-database`, `report-scheduler`.

## Persiapan go-live — 14 Oktober 2026

Folder lokal `build/` (skrip uji coba, laporan audit, dan backup database 1–2 Oktober, ±557 MB) dihapus. Data simulasi di database produksi dikosongkan dengan SQL reset sekali jalan yang diuji lebih dulu pada skema lokal; akun, cabang, pengaturan, shortcut stok, dan tahapan produksi dipertahankan.
