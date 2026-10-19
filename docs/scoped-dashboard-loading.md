# Pemuatan dashboard berdasarkan periode

Login memuat order yang belum difinalisasi, order masuk/arsip pada periode pilihan,
serta order dengan aktivitas pada periode tersebut. Riwayat lengkap milik order
terpilih tetap tersedia agar milestone pertama, kunjungan ulang, durasi proses,
dan output tidak berubah. Arsip di luar periode tidak diunduh ke browser.

`0025_scoped_snapshot.sql` menambahkan RPC baca dengan `SECURITY INVOKER` dan indeks.
Semua query tetap mengikuti RLS. Detail order di luar periode dimuat berdasarkan
ID pada URL. Pergantian periode memuat data baru tanpa menghapus state filter.
Menu dengan periode yang sudah tersedia menggunakan cache yang sama.
Saat meninggalkan laporan dengan periode luas, data kembali dipersempit agar
riwayat bulanan tidak terus bertahan dalam memori browser.

Pembaruan biasa memakai cursor sinkronisasi dan hanya mengambil baris berubah.
Order yang baru memasuki cakupan memicu snapshot agar riwayat lamanya juga lengkap.
Notifikasi realtime dibatasi menjadi satu pembaruan tertunda selama fetch berjalan.
Permintaan baca memiliki batas waktu 30 detik; kegagalan tidak memajukan cursor.

Riwayat dibaca menggunakan cursor UUID sebanyak maksimal 5.000 baris per
permintaan. Halaman lanjutan memakai daftar identitas dari halaman pertama,
tetap melewati RLS, dan tidak mengunduh ulang order/pelanggan. Hasil baru
ditampilkan setelah semua halaman berhasil; kegagalan tidak menerbitkan laporan
parsial. Indikator berputar menampilkan jumlah riwayat yang sudah diterima.
Pengujian live dengan batas statement delapan detik menyelesaikan 180.154
riwayat dalam 37 halaman tanpa kehilangan/duplikasi baris.

`0026_cached_branch_reads.sql` hanya berlaku pada database multi-cabang lama; pada
database satu lokasi migrasi ini tidak mengubah apa pun.

Migrasi 0025–0029 sudah aktif di produksi (1–2 Oktober 2026) dan disertakan dalam
`supabase/SETUP.sql` untuk instalasi berikutnya. Skrip aktivasi dan
verifikasi sekali jalan (`activate-scoped-loading`, `verify-scoped-loading`,
`activate-compact-transitions`, `remove-unused-archive-history`) sudah dihapus dari
repo dan tetap tersedia di riwayat git (commit `0fc26c9`).

Mode produksi: hentikan `npm run dev`, jalankan `npm run build`, lalu `npm run start`.

## Enam tahap dan pencatatan ringkas

`0027_compact_transitions.sql` mempertahankan satu catatan awal per order dan
menulis satu baris untuk setiap perpindahan: selesai/keluar beserta tahap tujuan.
Revisi tetap dicatat untuk durasi yang akurat. Client membentuk kembali kejadian
masuk di memori; tidak membutuhkan baris masuk terpisah di database.
Board hanya memiliki enam tahap. Konfirmasi **Order diterima customer** pada
Order Selesai langsung memfinalisasi arsip dan melepas foto. Arsip lama yang belum
difinalisasi muncul di Order Selesai dan dapat disimpan lewat tombol yang sama.
Laporan proses menampilkan selesai saja; selesai pada tahap terakhir berarti
order telah diterima customer. Metode pickup/delivery lama tetap tersimpan,
sementara kategori di layar disatukan.

`0028_skip_archive_process_reads.sql` mengeluarkan baris tahap ARCHIVE dari RPC
dashboard. Jumlah penerimaan dihitung dari `orders.archive_finalized_at`, dan
durasi produksi tetap menggunakan tahap produksi. Riwayat tersimpan tidak dihapus.

Pada 2 Oktober 2026, setelah persetujuan eksplisit pengguna, 13.259 catatan
`entered` tahap ARCHIVE dihapus lewat skrip sekali jalan (sudah dihapus dari repo).
Jumlah riwayat tersimpan menjadi 166.896. Hash semua order/pelanggan/akun/cabang/
tahapan dan seluruh riwayat selain ARCHIVE diperiksa identik sebelum commit.

`0029_manual_spk_on_create.sql` memakai kode SPK dari form tambah order, dengan
trim spasi dan penolakan kode kosong bila dikirim. Kode yang sama ditolak oleh
constraint unik; retry UUID yang sama tetap tidak membuat order ganda.
Klien lama yang belum mengirim field SPK tetap memakai generator sebelumnya.
