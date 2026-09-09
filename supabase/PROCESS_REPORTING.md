# Laporan proses online

Order, posisi produksi, dan riwayat berasal dari Supabase. Browser tidak menyimpan order, antrean perubahan offline, atau data contoh. Semua perubahan memakai RPC terautentikasi dan versi order untuk mendeteksi konflik antarperangkat. Saat koneksi gagal, perubahan dinonaktifkan.

Realtime memberi notifikasi perubahan dan aplikasi mengambil ulang data dari database. Pemeriksaan berkala setiap 30 detik membantu pemulihan jika notifikasi terlewat. Semua ini memerlukan internet.

- Order memiliki satu ID permanen meskipun SPK atau nama customer berubah.
- Perpindahan hanya satu tahap maju atau mundur. Trigger database mencatat riwayat dalam transaksi yang sama.
- Laporan dibuka pada Order Masuk, periode Hari Ini, zona waktu Asia/Jakarta.
- Masuk dan selesai dihitung dari kejadian pertama per order dan tahap sebelum penyaringan tanggal. Perpindahan berulang tidak menggandakan laporan.
- Revisi tidak ditampilkan sebagai metrik penyelesaian.
- Order belum selesai tetap tersedia keesokan hari tanpa reset otomatis.
- Order Done masuk board Arsip setelah penyerahan dikonfirmasi. Tombol Selesai menetapkan waktu finalisasi server dan mengeluarkan order dari board, tetapi mempertahankannya dalam laporan arsip.
- Laporan Arsip hanya menghitung penyelesaian berdasarkan tanggal finalisasi.

Lihat ONLINE_SETUP.md untuk setup database. Migrasi 0009 menghapus endpoint impor browser lama tanpa menghapus order online yang sudah tersimpan.

## Timer dan durasi produksi

Timer dimulai pada catatan masuk pertama ke Proses Desain atau Menunggu Pembayaran, dan berhenti pada catatan masuk pertama ke Order Selesai. Tidak menggunakan tanggal pembuatan order atau tanggal diterima customer sebagai pengganti timestamp yang hilang. Data yang tidak lengkap ditampilkan sebagai belum tercatat.

Order Masuk tidak menampilkan timer berjalan. Tahap yang dihitung: Desain, Menunggu Pembayaran, Sublim, dan Press. Tahap dilewati tidak diberi durasi. Kunjungan ulang sebelum penyelesaian pertama dijumlahkan; total tetap durasi kalender antara awal dan akhir produksi, termasuk malam dan hari libur. Setelah penyelesaian pertama, total terkunci meskipun kartu dipindahkan kembali.

Board menampilkan total produksi pada Order Selesai dan Order Diterima Customer. Detail order menampilkan rincian tahap produksi. Rata-rata total laporan memakai tanggal masuk Order Selesai dan mengecualikan order yang belum memiliki waktu awal/akhir. Rata-rata tahap mengikuti tanggal keluar terakhir di dalam jendela produksi.

Perhitungan menggunakan riwayat database yang sudah tersimpan, tanpa migrasi baru atau penulisan timer per detik.
