# Menjalankan mode online

1. Database baru: jalankan migrasi 0001 sampai 0006 berurutan di Supabase SQL Editor. Jika tabel sudah ada, jangan ulangi migrasi awal.
2. Jalankan `SETUP_ONLINE.sql` (gabungan migrasi 0007 dan 0008, aman dijalankan ulang).
3. Buat akun admin di Authentication > Users, lalu jalankan `ACTIVATE_ADMIN.sql`.
4. Isi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` atau `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` di `.env.local` dan Environment Variables Vercel. File env tidak masuk Git.
5. Login ke web. Banner koneksi menunjukkan status database dan realtime. Uji perubahan order pada dua browser yang login.

## Mengganti data dengan 20 order baru

Jalankan `RESET_20_ORDERS.sql` secara manual di SQL Editor setelah setup online berhasil. Script ini menghapus seluruh order lama, termasuk arsip dan riwayat proses serta item jadwal terkait, kemudian membuat 20 order baru di Order Masuk. Akun, direktori customer, mesin, dan tahapan produksi tetap tersimpan.

Tanggal order mengikuti tanggal eksekusi dalam WIB. Lima jenis produksi masing-masing memiliki empat order. Riwayat masuk dicatat oleh trigger normal database. Semua perubahan berada dalam satu transaksi; jika gagal, data tabel sebelumnya dipulihkan oleh rollback.

Script reset tidak otomatis dijalankan ketika push atau deploy, agar deployment berikutnya tidak menghapus order yang sudah dikerjakan. Hasil query terakhir harus menunjukkan `total_order = 20` dan `jenis_produksi = 5`. Muat ulang web setelah reset. Jangan menggunakan tombol impor data browser lama jika ingin mempertahankan hanya 20 order baru ini.

Untuk mempertahankan data browser lama sebagai gantinya, admin bisa menggunakan tombol impor pada web di browser yang menyimpan data tersebut. Impor mempertahankan identitas/tanggal dan tidak menghapus salinan lokal.

## Pemeriksaan lokal

```sh
node --test tests/database.test.mjs src/lib/production-board.test.mjs src/lib/process-metrics.test.mjs
npm run lint
npm run build
```

Pengujian database lokal dan simulasi realtime tidak menggantikan pemeriksaan koneksi dua perangkat ke Supabase asli.
