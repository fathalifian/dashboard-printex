# Laporan proses

## Order aktif dan arsip

Alur terbaru: **Done → board Arsip → tombol Selesai → Laporan Arsip**. `archivedAt` mencatat penyerahan/masuk Arsip; `finalizedAt` mencatat klik Selesai. `useProductionOrders` menampilkan seluruh board termasuk Arsip yang belum selesai. Halaman `/archives` hanya menampilkan order dengan `finalizedAt`, dan filter tanggal memakai nilai tersebut dalam WIB. Klik Selesai melakukan satu penulisan penyimpanan sebelum menghilangkan kartu; klik ulang tidak mengubah tanggal atau menggandakan laporan. Arsip versi sebelumnya yang belum memiliki `finalizedAt` akan kembali terlihat pada kolom Arsip sampai diselesaikan.

Migrasi `0005_archive_finalization.sql` menambahkan `archive_finalized_at` dan memperbarui aturan arsip. Board database memfilter `archive_finalized_at IS NULL`; Laporan Arsip memfilter `IS NOT NULL` dengan tanggal `(archive_finalized_at AT TIME ZONE 'Asia/Jakarta')::date`. Update timestamp ini saat tombol Selesai ditekan; trigger menetapkan waktu server dan menolak perubahan data arsip lainnya. Terapkan setelah migrasi 0004. Migrasi belum dijalankan ke database jarak jauh.

Reset data contoh yang diminta pengguna menggunakan penanda tetap `printex-fresh-ten-orders-20260907-v1`. Saat browser pertama memuat versi ini, data lama dicadangkan pada key bersufiks `-backup`, lalu diganti 10 order ber-ID baru di Order Masuk dengan tanggal WIB saat reset. Riwayat aktif dimulai dengan 10 catatan masuk baru. Reset tidak diulang saat refresh atau berganti hari; jangan mengganti penanda berdasarkan tanggal. Data tersimpan lokal, sehingga reset diterapkan per browser saat memuat aplikasi.

Order belum selesai tetap tersedia lintas hari. `archiveOrder` hanya menerima order Done dengan metode `pickup` atau `delivery`. Order arsip mempertahankan ID, detail, tanggal penyerahan, dan riwayat. Hook `useBoardOrders` hanya mengembalikan order yang belum diarsipkan; `useAllOrders` dipakai untuk arsip, detail, dan laporan. Order arsip tidak dapat digeser, diedit, atau dihapus melalui fungsi order biasa.

Migrasi `0004_order_archiving.sql` menambahkan metadata penyerahan dan aturan arsip pada database. Terapkan setelah migrasi 0003. Pengarsipan database dilakukan dengan memperbarui `current_step_id` ke ARCHIVE beserta `delivery_method` dalam satu UPDATE; timestamp ditetapkan server, dan trigger riwayat tetap mencatatnya. Tidak ada penghapusan otomatis atau reset harian. Migrasi ini belum diterapkan ke database jarak jauh.

Halaman `/reports` memakai riwayat perpindahan board lokal, bukan estimasi dari status terakhir. Riwayat tersimpan pada `printex-process-history-v1`. Data lama tidak diisi dengan tanggal buatan. Menghapus order tidak menghapus riwayatnya.

## Database

Jalankan migrasi `0001_initial_schema.sql`, `0002_process_reporting.sql`, lalu `0003_unique_process_reports.sql` secara berurutan pada project Supabase tujuan. Migrasi kedua menambahkan riwayat dan trigger. Migrasi ketiga menambahkan identitas order permanen serta view `process_order_milestones`, dan memperbaiki `process_daily_reports` agar menghitung order unik. Migrasi belum diterapkan otomatis ke database jarak jauh.

`process_order_milestones` mengambil kejadian pertama per identitas order, proses, dan jenis aktivitas sebelum memfilter tanggal/karyawan. Pakai view ini untuk rincian dan ekspor laporan. Riwayat mentah tetap disimpan untuk audit. Identitas tetap ada setelah order dihapus. Untuk riwayat database lama yang order-nya sudah dihapus sebelum migrasi ketiga, identitas hanya dapat dipulihkan berdasarkan SPK yang tersimpan.

Trigger merekam waktu server, aktor dari `auth.uid()`, nama aktor saat kejadian, serta penugasan designer yang ada pada order. `actor_id` adalah karyawan yang mencatat perubahan, bukan selalu karyawan yang mengerjakan pekerjaan. Untuk atribusi operator per tahap, tambahkan penugasan tahap sebelum memakai laporan sebagai evaluasi individu.

Saat mengintegrasikan board dengan Supabase, simpan perubahan `current_step_id` lewat pengguna terautentikasi, dan baca riwayat menggunakan RLS. Jangan mengirim event tambahan dari browser karena trigger sudah mencatatnya dalam transaksi yang sama. Frontend saat ini tetap menggunakan sumber lokal dan menampilkan batasan ini secara eksplisit; belum ada sinkronisasi database atau filter identitas karyawan nyata.

RLS tabel riwayat hanya mengizinkan baca oleh profil aktif. Hak tulis order/profil dan kebijakan per peran untuk tabel awal harus dikonfigurasi sebelum membuka akses produksi. Tabel riwayat tidak memberikan hak tulis langsung kepada klien.

## Definisi metrik

- Masuk: pertama kali order memasuki tahap tersebut; masuk ulang tidak menambah angka.
- Selesai: meninggalkan tahap menuju tahap dengan urutan lebih tinggi.
- Kembali/revisi: meninggalkan tahap menuju urutan lebih rendah; tidak dihitung selesai.
- Memindahkan ke tahap yang sama tidak menghasilkan event.
- Melewati tahap tidak membuat event selesai pada tahap yang dilewati.
- Semua tanggal laporan memakai Asia/Jakarta. Mingguan berarti tujuh hari kalender terakhir termasuk hari ini.
- Setiap ID order dihitung maksimal satu kali untuk masing-masing metrik masuk, selesai, dan revisi per proses sepanjang riwayatnya. Mengganti SPK/nama customer tidak menciptakan identitas baru. Semua metrik memakai tanggal kejadian pertama; perpindahan ulang pada hari lain tidak menambah hitungan. Selesai hari ini dapat berasal dari pekerjaan masuk kemarin. Total mingguan konsisten dengan jumlah grafik harian.
- Posisi order saat ini merupakan snapshot terpisah, tidak mengikuti rentang tanggal atau filter karyawan.
