# Menjalankan mode online

1. Database baru: jalankan migrasi 0001 sampai 0006 berurutan di Supabase SQL Editor. Jika tabel sudah ada, jangan ulangi migrasi awal.
2. Jalankan `SETUP_ONLINE.sql` (setup online dan penghapusan endpoint impor lokal, aman dijalankan ulang).
3. Buat akun admin di Authentication > Users, lalu jalankan `ACTIVATE_ADMIN.sql`.
4. Isi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` atau `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` di `.env.local` dan Environment Variables Vercel. File env tidak masuk Git.
5. Login ke web. Uji perubahan order pada dua browser yang login.

## Mengganti data dengan 20 order baru

Jalankan `RESET_20_ORDERS.sql` secara manual di SQL Editor setelah setup online berhasil. Script ini menghapus seluruh order lama, termasuk arsip dan riwayat proses serta item jadwal terkait, kemudian membuat 20 order baru di Order Masuk. Akun, direktori customer, mesin, dan tahapan produksi tetap tersimpan.

Tanggal order mengikuti tanggal eksekusi dalam WIB. Lima jenis produksi masing-masing memiliki empat order. Riwayat masuk dicatat oleh trigger normal database. Semua perubahan berada dalam satu transaksi; jika gagal, data tabel sebelumnya dipulihkan oleh rollback.

Script reset tidak otomatis dijalankan ketika push atau deploy, agar deployment berikutnya tidak menghapus order yang sudah dikerjakan. Hasil query terakhir harus menunjukkan `total_order = 20` dan `jenis_produksi = 5`. Muat ulang web setelah reset.

Database yang sudah online: jalankan migrasi `0009_remove_local_import.sql` untuk menghapus endpoint impor lama. Order dan laporan online tetap tersimpan.

## Pemeriksaan lokal

```sh
node --test tests/database.test.mjs src/lib/production-board.test.mjs src/lib/process-metrics.test.mjs
npm run lint
npm run build
```

Pengujian database lokal dan simulasi realtime tidak menggantikan pemeriksaan koneksi dua perangkat ke Supabase asli.

## Tujuh tahap produksi

Database yang sudah terpasang: jalankan `migrations/0010_seven_stage_workflow.sql`. Tahap lama DESIGN_DONE dipetakan ke Menunggu Pembayaran dan PRINTING ke Proses Sublim dengan ID yang sama; riwayat lama tetap tersimpan di tahap tersebut. Tahap Press ditambahkan tanpa membuat riwayat buatan untuk order lama.

Order Masuk boleh langsung ke Menunggu Pembayaran jika desain sudah tersedia. Khusus DTF, Proses Sublim boleh langsung ke Order Selesai. Tahap yang dilewati tidak memiliki event masuk atau selesai. Perpindahan lain tetap satu tahap maju/mundur; penerimaan customer tetap memerlukan konfirmasi penyerahan.

## Manajemen User dari website

1. Jalankan migrations/0011_user_management.sql melalui SQL Editor sekali untuk database yang sudah ada.
2. Tambahkan SUPABASE_SECRET_KEY (atau SUPABASE_SERVICE_ROLE_KEY) ke .env.local dan Environment Variables Vercel. Gunakan secret key dari pengaturan API Keys Supabase; jangan memakai awalan NEXT_PUBLIC_ dan jangan memasukkan key ke Git. Restart server development atau redeploy setelah mengisi konfigurasi.
3. Login sebagai Super Admin, buka Pengaturan ? Kelola Pengguna. Tambah akun dengan nama, email, password awal minimal 12 karakter, role, dan status aktif. Akun aktif dapat langsung login tanpa email konfirmasi.
4. Edit untuk mengganti nama/role/status. Hapus mencabut akses lebih dahulu, lalu menghapus akun login dan profil secara permanen. Riwayat order dipertahankan. Bila penghapusan login gagal, akun tetap nonaktif dan tombol Hapus bisa dicoba kembali.

Role yang didukung adalah superadmin, admin, staff. Hanya superadmin mengelola akun. Admin dan staff memiliki akses operasional order yang sama; pembatasan operator per tahap belum diterapkan. Daftar akun dimuat ulang setelah aksi, saat fokus browser kembali, dan setiap 30 detik. Perubahan profil juga masuk kanal realtime operasional.

Referensi Auth Admin: https://supabase.com/docs/reference/javascript/auth-admin-createuser dan https://supabase.com/docs/reference/javascript/auth-admin-deleteuser

## Penghapusan permanen pengguna

Jalankan migrations/0012_hard_delete_users.sql pada database yang sudah ada. Migrasi mengatur referensi pengguna menjadi NULL ketika profil dihapus, termasuk pada order arsip, tanpa menghapus order atau laporan. Akun lama yang sebelumnya dihapus sebagian ditampilkan kembali untuk dicoba hapus sampai selesai.
