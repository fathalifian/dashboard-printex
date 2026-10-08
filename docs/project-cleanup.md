# Audit pembersihan proyek — 3 Oktober 2026

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
