# Migrasi cabang produksi

Sumber resmi adalah file SQL bernomor di folder ini, setelah migrasi dasar `supabase/migrations/0001` sampai `0021`. Folder pilot hanya untuk kompatibilitas instalasi lama dan tes akun uji.

## Database cabang yang sudah aktif

1. Buat backup database sesuai prosedur lingkungan produksi.
2. Jalankan `npm run db:branch-upgrade -- --existing` di workspace.
3. Tinjau dan jalankan `supabase/UPGRADE_BRANCHES.sql` di SQL Editor proyek Supabase yang benar.
4. Deploy aplikasi dan muat ulang browser.

Paket upgrade menjalankan 0021 dan tujuh migrasi cabang dalam satu transaksi. Paket tidak membuat akun uji, tidak mengganti password, tidak mengubah role atau cabang akun yang sudah ditetapkan. Pengaturan cabang yang sudah ada tetap dipertahankan. Aman dijalankan ulang. Nama cabang Salatiga/Semarang yang sudah dipakai proyek ini tetap dipertahankan.

## Instalasi baru atau database satu cabang

Jalankan migrasi dasar 0001?0021 berurutan terlebih dahulu. Tentukan cabang pemilik data lama secara eksplisit:

- `npm run db:branch-upgrade -- Salatiga`
- atau `npm run db:branch-upgrade -- Semarang`

Jalankan SQL hasilnya. Profil nonpusat dan data lama yang belum mempunyai cabang akan ditempatkan pada pilihan itu; data yang sudah mempunyai cabang tidak dipindahkan. Akun Owner Pusat yang sudah ada dipertahankan. Pada instalasi baru, administrator database perlu menetapkan akun pusat yang sah secara eksplisit; paket tidak otomatis menaikkan hak akun.

Jangan menjalankan setup satu cabang atau file pilot setelah migrasi cabang. `SETUP_ONLINE.sql` sekarang menolak database yang sudah memiliki cabang agar kebijakan cabang tidak tertimpa.

## Verifikasi

Login dengan akun aktif lalu panggil `printex_online_status`: `branch_schema_version=4`, `branch_settings_enabled=true`, `incremental_sync_enabled=true`. Uji dua akun cabang dan Owner Pusat. `npm test` menguji instalasi dari skema lama, upgrade pilot, pemasangan ulang tanpa perubahan order, izin lintas cabang, serta cursor perubahan dan rollback.

## Sinkronisasi

0021 memasang clock transaksional dan daftar ID yang berubah, tanpa menyalin isi pelanggan/order. RPC mengecek hak cabang; pengambilan baris tetap melalui RLS. Cache hanya dalam memori browser, dipisahkan berdasarkan akun, role, dan cabang. Penghapusan juga diikuti. Cursor hanya diperbarui setelah seluruh pengambilan berhasil.

Pemuatan pertama tetap mengambil dataset lengkap untuk menjaga laporan historis dan durasi produksi yang sudah ada. Setelah itu hanya baris berubah yang diambil; data tidak berubah tidak diunduh ulang. Jika 0021 belum terpasang, aplikasi tetap memakai sinkronisasi penuh. Untuk volume historis sangat besar, pagination laporan dan agregasi database adalah tahap skalabilitas berikutnya. Clock menyerialkan pencatatan transaksi perubahan; pantau waktu tunggu lock ketika volume penulisan meningkat.

CI menggunakan database lokal PGlite dan tidak mengakses database produksi. Aktivasi migrasi dan deployment produksi dilakukan terpisah dari pengujian.

## Customer Service bersama

Migrasi `0005_shared_customer_service.sql` memakai satu nomor tim TI untuk seluruh cabang, termasuk mode Semua cabang. Stock tetap per cabang. Akun aktif dapat membaca nomor; Admin dan Owner dapat mengubah nomor bersama, Operator hanya membaca. Nomor bersama yang sudah ada dipertahankan. Nomor cabang tidak dipilih otomatis. Jika nomor bersama kosong atau perlu diganti, isi nomor resmi tim TI sekali di Pengaturan. Data nomor cabang lama tetap tersimpan tetapi akses aplikasi ke tabel lama ditutup. Instalasi cabang yang sudah memiliki 0001?0004 cukup menjalankan 0005; paket UPGRADE_BRANCHES juga menyertakannya.

## Lebar kertas Sublim

Jalankan `0006_paper_width.sql` untuk database cabang yang sudah aktif (atau paket UPGRADE_BRANCHES terbaru). Database satu cabang menggunakan `supabase/migrations/0022_paper_width.sql`. Pilihan 1,2 / 1,6 / 1,8 meter untuk seluruh produksi selain DTF (Sublim, Umbul-umbul, Batik, Jersey). Nilai lama tetap NULL dan tidak ditebak. Form baru mewajibkan pilihan untuk seluruh produksi selain DTF; RPC menerima field yang dihilangkan oleh klien lama tanpa menghapus nilai tersimpan. Grafik menjumlahkan meter panjang order pada penyelesaian print pertama dalam WIB, mengikuti periode dan cabang aktif; ini bukan luas atau konsumsi kertas termasuk limbah.

Setelah migrasi lebar kertas awal, jalankan `0007_non_dtf_paper_width.sql` untuk memperluas pilihan ke Umbul-umbul, Batik, dan Jersey. Paket UPGRADE_BRANCHES terbaru sudah menyertakan keduanya.


## Kelola Cabang (0008)

Untuk instalasi cabang yang sudah aktif, jalankan `0008_branch_management.sql` di Supabase SQL Editor. Migrasi ini tidak menghapus data yang ada. Server memerlukan `SUPABASE_SECRET_KEY` atau `SUPABASE_SERVICE_ROLE_KEY` untuk membersihkan file melalui Storage API dan akun melalui Auth Admin API.

Owner Pusat dapat membuat cabang kosong, mengganti nama, dan menghapus cabang. Semua cabang tetap menggunakan satu proyek/database dan bucket privat `order-photos`; RLS membatasi data dan file menurut cabang pemilik order. Cabang baru mendapat identitas UUID dan pengaturan stok sendiri, tanpa menyalin data cabang lain. Foto menggunakan folder UUID order yang terikat pada cabang.

Penghapusan memerlukan pengetikan nama cabang. Tahap pertama membekukan akses cabang, menonaktifkan akun, menghapus data order/riwayat/pelanggan dan menyimpan daftar file serta akun untuk pembersihan. Server menghapus file melalui Storage API, lalu akun Auth, dan menyelesaikan penghapusan pengaturan serta cabang. Jika gagal, cabang tetap tercantum sebagai penghapusan belum selesai dan tombol **Lanjutkan Hapus** melanjutkan pekerjaan. Akun Owner Pusat, nomor Customer Service bersama, dan cabang lain tetap dipertahankan. Jangan menghapus metadata `storage.objects` lewat SQL pada database produksi.


## Perbaikan penghapusan arsip (0009)

Setelah 0008, jalankan `0009_archive_branch_deletion.sql`. Penghapusan cabang yang dikonfirmasi Owner Pusat kini juga dapat membersihkan order arsip. Order arsip tetap tidak dapat dihapus melalui alur order biasa. Paket `UPGRADE_BRANCHES.sql` terbaru juga tidak membuat kembali cabang bawaan yang sudah dihapus saat dijalankan ulang.

DTF 0,6 m: jalankan `0010_dtf_paper_width.sql` untuk database cabang atau `supabase/migrations/0024_dtf_paper_width.sql` untuk database satu cabang. RPC otomatis mengisi 0,6 untuk DTF saat tambah/edit. Grafik mengelompokkan seluruh DTF termasuk order lama ke DTF 0,6 m; data lama tidak ditulis ulang.
