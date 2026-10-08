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

Aktivasi live: `node --env-file=.env.local scripts/activate-scoped-loading.mjs --execute`.
Script mencadangkan definisi fungsi sebelumnya dan memverifikasi hash semua order,
pelanggan, riwayat, akun, cabang, dan tahapan sebelum commit. Tidak menghapus data.

`0026_cached_branch_reads.sql` adalah optimasi tambahan untuk mengevaluasi akses
cabang sekali per query. Pengaktifan live memerlukan persetujuan khusus karena
menyentuh kebijakan RLS. Setelah disetujui, tambahkan `--include-access-cache` pada
perintah aktivasi. Tes memastikan cabang lain, pengguna nonaktif, dan anon tetap
ditolak. Definisi fungsi dan kebijakan sebelumnya disimpan sebelum perubahan.

Verifikasi live baca-saja:
`node --env-file=.env.local scripts/verify-scoped-loading.mjs`.
Membandingkan output, tren, laporan proses, kertas, dan produktivitas hari ini dan
bulanan dengan dataset lengkap. Hasil di `build/scoped-loading-verification.json`.

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

Aktivasi tanpa mengubah baris lama:
`node --env-file=.env.local scripts/activate-compact-transitions.mjs --schema-only`.
Penggabungan riwayat lama memerlukan persetujuan terpisah. Pratinjau baca saja:
`node --env-file=.env.local scripts/activate-compact-transitions.mjs`.
Setelah disetujui, `--execute` membuat cadangan penuh riwayat dan definisi fungsi,
menggabungkan hanya pasangan yang tidak ambigu, memeriksa hash riwayat logis,
dan memastikan order/pelanggan/akun/cabang tidak berubah sebelum commit.

`0028_skip_archive_process_reads.sql` mengeluarkan baris tahap ARCHIVE dari RPC
dashboard. Jumlah penerimaan dihitung dari `orders.archive_finalized_at`, dan
durasi produksi tetap menggunakan tahap produksi. Riwayat tersimpan tidak dihapus.
Aktivasi hanya query baca:
`node --env-file=.env.local scripts/activate-compact-transitions.mjs --read-optimization-only`.

Pada 2 Oktober 2026, setelah persetujuan eksplisit pengguna, 13.259 catatan
`entered` tahap ARCHIVE dihapus lewat `scripts/remove-unused-archive-history.mjs`.
Jumlah riwayat tersimpan menjadi 166.896. Hash semua order/pelanggan/akun/cabang/
tahapan dan seluruh riwayat selain ARCHIVE diperiksa identik sebelum commit.
Cadangan baris yang dihapus dan hasil pemeriksaan disimpan di
`build/backups/unused-archive-history-2026-10-02T03-09-28-992Z/`.
Script menolak penghapusan jika penyaringan arsip belum aktif atau terdapat
catatan selesai/revisi/transisi pada tahap ARCHIVE.

`0029_manual_spk_on_create.sql` memakai kode SPK dari form tambah order, dengan
trim spasi dan penolakan kode kosong bila dikirim. Kode yang sama ditolak oleh
constraint unik; retry UUID yang sama tetap tidak membuat order ganda.
Klien lama yang belum mengirim field SPK tetap memakai generator sebelumnya.
Aktivasi tanpa mengubah baris lama:
`node --env-file=.env.local scripts/activate-compact-transitions.mjs --manual-spk-only`.
