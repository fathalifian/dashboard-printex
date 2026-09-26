> **Arsip uji coba.** Untuk pemasangan/upgrade produksi, gunakan [panduan migrasi resmi](../branch-migrations/README.md). File aktivasi lama disimpan hanya untuk pengujian kompatibilitas; jangan digunakan untuk upgrade produksi.

# Uji coba dua cabang

- Salatiga: seluruh data lama dan akun lama tetap di sini.
- Semarang: mulai tanpa order.
- Owner Pusat: melihat semua cabang atau memilih satu cabang dari header.
- Owner/Admin/Operator cabang: hanya membaca order, customer, riwayat, dan foto cabangnya.
- Owner Pusat mengelola semua akun. Setelah ENABLE_BRANCH_OWNER_USERS.sql dijalankan, Owner Cabang dapat mengelola Admin/Operator cabangnya sendiri.
- Pilih satu cabang sebelum menambah order. Mode Semua cabang menampilkan rekap gabungan.
- Pengaturan lama bersifat bersama; migrasi resmi memisahkan Stock dan Customer Service per cabang.
- Data hanya difilter per cabang di server. Mode Semua cabang memuat seluruh data yang dapat diakses; pagination riwayat besar merupakan pekerjaan lanjutan sebelum peluncuran 12 cabang.

## Aktivasi

1. Gunakan kode aplikasi terbaru secara lokal untuk uji coba.
2. Buka Supabase SQL Editor pada proyek yang sama.
3. Jalankan seluruh isi ACTIVATE_SALATIGA_SEMARANG.sql. File ini menyertakan dependensi foto dan mengaktifkan tiga akun uji yang sudah dibuat. Tidak perlu menjalankan migrasi foto terpisah.
4. Logout, kemudian login kembali memakai akun uji di file lokal .env.pilot-accounts.json.
5. Bandingkan akun Admin Salatiga dan Admin Semarang; data lama hanya muncul di Salatiga.
6. Login Owner Pusat untuk melihat dua kartu cabang dan pilihan Semua cabang.

Email .test adalah akun uji; tidak ada pengiriman email atau pemulihan password melalui alamat ini. Password acak disimpan hanya pada file lokal yang diabaikan Git.
Akun uji masih nonaktif sebelum SQL aktivasi dijalankan. Akun lama tetap memakai login yang sama.

Jangan menjalankan ulang SETUP_ONLINE.sql atau migrasi lama setelah aktivasi pilot karena definisi hak akses lama tidak mengenal cabang. Gunakan berkas aktivasi pilot untuk pemulihan dependensi pilot.
File SETUP_TWO_BRANCHES.sql adalah inti migrasi yang juga diuji otomatis, bukan berkas aktivasi akun.

## Pemeriksaan

node --test tests/pilot-branches.test.mjs src/lib/production-board.test.mjs

Uji meliputi isolasi RLS, pemalsuan branchId, akses langsung RPC lintas cabang, privasi foto, cleanup arsip, pemilih cabang, perlindungan Owner Pusat, dan pemasangan ulang.

## Hak Owner Cabang untuk membuat akun
Jalankan ENABLE_BRANCH_OWNER_USERS.sql sekali di SQL Editor setelah aktivasi cabang. Aman dijalankan ulang. Owner Cabang tidak dapat membuat Owner, mengganti cabang, atau mengambil alih akun cabang lain.

## Pengaturan terpisah per cabang

Setelah setup cabang dan `ENABLE_BRANCH_OWNER_USERS.sql`, jalankan `ENABLE_BRANCH_SETTINGS.sql` di Supabase SQL Editor sebelum memakai aplikasi versi ini. Script aman dijalankan ulang. Stock dan Customer Service disimpan per cabang dengan RLS; endpoint pengaturan bersama lama ditutup untuk akun aplikasi. Data lama tetap tersimpan di tabel lama, tetapi tidak otomatis disalin karena pemilik cabangnya belum diketahui. Isi link dan nomor masing-masing cabang melalui akun Owner Pusat/Owner Cabang/Admin. Cabang baru mendapat pengaturan kosong otomatis.

Owner Pusat memiliki hak operasional Owner Cabang di setiap cabang. Pilihan cabang mengganti order, pelanggan, riwayat, laporan, akun, tautan Stock, dan Customer Service; formulir dibuka ulang agar draft cabang sebelumnya tidak terbawa. Mode Semua cabang tetap tersedia untuk ringkasan pusat dan manajemen akun pusat; pengaturan Stock/Customer Service membutuhkan satu cabang. Pemisahan menggunakan baris bertanda cabang dan kebijakan akses database dalam satu proyek Supabase.
