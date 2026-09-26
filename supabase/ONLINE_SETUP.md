# Menjalankan mode online

## Shortcut spreadsheet stok (0017)

Jalankan `migrations/0017_stock_shortcuts.sql`, lalu `migrations/0018_owner_stock_shortcuts.sql` melalui Supabase SQL Editor untuk menyimpan nama dan link dua shortcut di Board Produksi. Jika 0017 sudah terpasang, cukup jalankan 0018 untuk menambahkan hak Owner. Tautan awal tetap tersedia sebelum migrasi. Owner dan Admin aktif dapat mengubah nama/link melalui ikon pensil; Operator hanya dapat membuka tautan. Aturan yang sama diterapkan di server dan RLS database. Perubahan terlihat di perangkat lain saat kembali ke halaman atau saat pembaruan berkala (30 detik). Menjalankan ulang migrasi tidak menimpa shortcut yang sudah diedit.

## Foto order

Untuk database yang sudah online, jalankan `migrations/0015_order_photos.sql` melalui Supabase SQL Editor. Migrasi ini menambah kolom foto opsional dan bucket privat `order-photos` (JPG/PNG/WebP, maksimal 5 MB untuk file sumber). Owner/Admin menyeret satu file foto dari file manager langsung ke kartu order di Kanban. Penanda hanya muncul saat file berada di atas kartu, tanpa area unggah permanen. Foto otomatis diunggah ke order tersebut dan dapat dilihat di Detail Order. Menjatuhkan foto baru pada kartu yang sama mengganti foto lama. Seret kartu antar tahap tetap berfungsi seperti biasa. Order arsip dan akun Operator tidak dapat mengunggah foto. Tanpa foto, alur order tetap berjalan seperti biasa.

Foto menggunakan tautan sementara dan diperbarui otomatis saat halaman aktif. File pengganti menggunakan lokasi baru agar foto antarperangkat tidak tertimpa cache. Jika koneksi putus saat penyimpanan, muat ulang board sebelum mencoba kembali.

### Kompresi dan pembersihan otomatis (0016)

Jalankan `migrations/0016_photo_cleanup.sql` setelah 0015 untuk mengaktifkan pembersihan aman. Setup lengkap sudah mencakup keduanya.

- Foto baru diperkecil di browser sebelum diunggah: WebP, sisi terpanjang maksimal 1.600 piksel, target 200–400 KB. Foto sederhana boleh lebih kecil dari 200 KB. Kualitas dipilih antara 0,72 dan 0,92; jika 400 KB tidak tercapai pada batas kualitas ini, unggahan ditolak dan pengguna diminta memotong area yang tidak diperlukan. Hasil kompresi dapat diperiksa melalui Detail Order setelah unggahan selesai.
- Setelah order dihapus permanen, file fotonya langsung dibersihkan melalui Storage API. Penghapusan atau penggantian foto juga memasukkan lokasi lama ke antrean database dalam transaksi yang sama.
- Unggahan gagal dibersihkan segera jika server memastikan file tidak dipakai order mana pun. Jika respons simpan hilang tetapi transaksi berhasil, foto yang tertaut tetap aman.
- Saat Owner/Admin aktif membuka aplikasi, pembersihan berjalan setiap sekitar 5 menit, maksimal 50 file per pemeriksaan. Ini mengulang penghapusan yang gagal dan memungut file tidak tertaut berumur lebih dari 24 jam (misalnya tab ditutup saat unggah). Saat semua aplikasi ditutup, antrean tetap tersimpan dan dilanjutkan saat Owner/Admin kembali online.
- RPC menandai file sebelum penghapusan; file yang ditandai tidak boleh ditautkan kembali. Storage API menghapus file sebenarnya, bukan sekadar baris metadata. Foto yang masih tertaut tidak dibersihkan. Baris antrean yang selesai dibuang setelah satu hari.

Migrasi tidak mengompresi atau menghapus foto lama yang masih dipakai order. Aturan penghapusan foto saat finalisasi arsip dijelaskan di bawah.

1. Database baru: jalankan migrasi 0001 sampai 0006 berurutan di Supabase SQL Editor. Jika tabel sudah ada, jangan ulangi migrasi awal.
2. Jalankan `SETUP_ONLINE.sql` (setup online dan penghapusan endpoint impor lokal, aman dijalankan ulang).
3. Buat akun Owner di Authentication > Users, lalu jalankan `ACTIVATE_ADMIN.sql`.
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
3. Login sebagai Owner, buka Pengaturan ? Kelola Pengguna. Tambah akun dengan nama, email, password awal minimal 8 karakter, role, dan status aktif. Akun aktif dapat langsung login tanpa email konfirmasi.
4. Edit untuk mengganti nama/role/status. Hapus mencabut akses lebih dahulu, lalu menghapus akun login dan profil secara permanen. Riwayat order dipertahankan. Bila penghapusan login gagal, akun tetap nonaktif dan tombol Hapus bisa dicoba kembali.

Role yang didukung adalah owner, admin, operator. Hanya Owner mengelola akun. Admin mengelola order dan laporan. Operator hanya membuka Dashboard dan Board Produksi; seluruh kolom board tetap terlihat. Daftar akun dimuat ulang setelah aksi, saat fokus browser kembali, dan setiap 30 detik. Perubahan profil juga masuk kanal realtime operasional.

Referensi Auth Admin: https://supabase.com/docs/reference/javascript/auth-admin-createuser dan https://supabase.com/docs/reference/javascript/auth-admin-deleteuser

## Penghapusan permanen pengguna

Jalankan migrations/0012_hard_delete_users.sql pada database yang sudah ada. Migrasi mengatur referensi pengguna menjadi NULL ketika profil dihapus, termasuk pada order arsip, tanpa menghapus order atau laporan. Akun lama yang sebelumnya dihapus sebagian ditampilkan kembali untuk dicoba hapus sampai selesai.

## Owner, Admin, dan Operator (migrasi 0013)

Untuk database yang sudah menjalankan migrasi 0012, jalankan `migrations/0013_owner_operator_permissions.sql` melalui Supabase SQL Editor sebelum memakai versi aplikasi ini. Database baru atau versi lama dapat mengikuti setup lengkap di atas; `SETUP_ONLINE.sql` sudah menyertakan migrasi 0013.

Migrasi mengubah `superadmin` menjadi `owner` dan `staff` menjadi `operator`. `admin` tetap sama. ID akun, status aktif, order, dan riwayat tidak dihapus. Aman dijalankan ulang. Aplikasi menunggu schema_version 8 sebelum mengaktifkan operasi.

| Hak akses | Owner | Admin | Operator |
|---|---|---|---|
| Dashboard dan seluruh kolom board | Ya | Ya | Ya |
| Laporan, arsip, detail order, pengaturan | Ya | Ya | Tidak |
| Tambah, edit, hapus, arsip order | Ya | Ya | Tidak |
| Kelola akun dan role | Ya | Tidak | Tidak |
| Pindahkan order | Alur yang berlaku | Alur yang berlaku | Hanya antara Menunggu Pembayaran, Sublim, Press, Order Selesai |

Untuk Operator, tahap asal **dan** tujuan harus berada di empat tahap tersebut. Aturan satu tahap maju/mundur tetap berlaku; DTF boleh melewati Press dari Sublim ke Order Selesai. Operator tidak dapat menarik order dari Order Masuk/Desain atau memindahkan ke kolom penerimaan customer. RPC membaca role aktif dari database dan mengunci profil serta order selama transaksi. Permintaan langsung tidak dapat melewati pembatasan ini.

Verifikasi setelah migrasi: masuk sebagai Operator; pastikan menu hanya Dashboard/Board, tombol tambah/edit/hapus/arsip tidak ada, seluruh tujuh kolom terlihat, perpindahan dalam area yang diizinkan berhasil, dan URL `/orders/new` atau `/reports` kembali ke Dashboard. Login Owner untuk mengelola akun.


## WhatsApp Customer Service (migrasi 0014)

Database yang sudah ada: jalankan `migrations/0014_customer_service.sql` melalui Supabase SQL Editor setelah migrasi 0013. Setup baru sudah menyertakannya di `SETUP_ONLINE.sql`. Migrasi ini tidak mengubah order atau nomor yang sudah tersimpan.

Login sebagai Admin atau Owner, buka **Pengaturan > WhatsApp Customer Service**, isi nomor (08 atau +62), lalu simpan. Nomor tersimpan untuk semua pengguna; sidebar diperbarui langsung pada perangkat penyimpan, ketika tab lain kembali aktif, atau dalam 60 detik pada tab aktif. Kosongkan nomor untuk menonaktifkan tautan. Operator hanya dapat membaca kontak; RLS database dan server action menolak perubahannya.


## Hapus foto saat Simpan ke Laporan Arsip

Jalankan `migrations/0019_archive_photo_cleanup.sql` setelah migrasi 0015 dan 0016.
Saat Owner/Admin menekan Simpan ke Laporan Arsip (aksi finish), database mengosongkan photo_path
dan memasukkan file lama ke antrean pembersihan dalam transaksi yang sama. Konfirmasi Diterima
saja masih mempertahankan foto selama order ada di board. Data order dan riwayat tetap tersimpan.

Aplikasi langsung mencoba menghapus file melalui Storage API. Jika gagal atau browser tertutup,
antrean tetap tersimpan dan dicoba kembali saat aplikasi Owner/Admin aktif (pemeriksaan setiap
5 menit melalui sinkronisasi). Tidak ada worker terjadwal ketika semua aplikasi ditutup.
Foto yang sudah dihapus tidak dapat dipulihkan melalui aplikasi.
Aturan berlaku untuk finalisasi setelah migrasi; foto arsip lama tidak dihapus massal.

Jika muncul error printex_queue_old_photo() does not exist, jalankan seluruh isi
supabase/REPAIR_ARCHIVE_PHOTOS.sql di SQL Editor. File ini memasang dependensi
0015, 0016, dan 0019 dalam satu transaksi dan aman dijalankan ulang. Tidak menghapus
foto arsip lama atau data order. Aplikasi terbaru tetap diperlukan untuk penghapusan
file langsung melalui Storage API saat finalisasi.

## No. WhatsApp customer opsional
Jalankan migrations/0020_optional_customer_phone.sql untuk menyimpan nomor dari Tambah Order. Kolom boleh kosong; nomor lama tetap dipertahankan ketika edit tanpa mengirim customerPhone.
