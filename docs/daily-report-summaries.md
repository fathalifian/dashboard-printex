# Ringkasan laporan harian

Dashboard, laporan proses, laporan arsip, grafik output, dan produktivitas membaca hasil yang tersimpan per tanggal WIB. Pengaturan hanya memuat profil. Board, order aktif, waktu berjalan, dan detail order tetap memakai data realtime.

## Penyimpanan dan pembaruan

- `report_daily_summaries`: jumlah order, meter, dan total durasi per tanggal, metrik, dan kategori. Rentang tanggal menjumlahkan ringkasan harian; rata-rata memakai jumlah durasi dibagi jumlah sampel, bukan rata-rata dari rata-rata.
- `report_contributions`: hasil per order yang sudah dihitung. Rincian laporan membaca tabel ini per halaman 50 baris; ekspor CSV membaca per batch 200 baris. Membuka laporan lama tidak mengunduh seluruh riwayat mentah.
- `report_refresh_queue`: order yang berubah. Trigger order, riwayat, dan perubahan nama customer menambahkan ID ke antrean; tidak menghitung seluruh laporan dalam transaksi penyimpanan order.
- Worker `printex-daily-report-refresh` berjalan setiap menit melalui `pg_cron`, termasuk saat aplikasi tidak dibuka. Pembaca laporan juga memproses maksimal 100 order tertunda. Penguncian advisory mencegah dua worker memperbarui ringkasan secara bersamaan.

Setiap hasil langsung memiliki tanggal WIB. Ketika hari berganti, hasil hari sebelumnya sudah tersimpan dan filter Hari ini berpindah ke tanggal baru. Koreksi order memperbarui kontribusi order tersebut dan selisih ringkasan terkait, sehingga tanggal lama tetap dapat dikoreksi tanpa menghitung ulang semua order.

Tabel turunan tidak dapat dibaca atau ditulis langsung oleh akun pengguna. RPC memeriksa akun aktif. Cache browser dipisahkan menurut akun, role, dan tanggal; permintaan bersama dipakai ulang dan jumlah entri cache dibatasi. Data bisnis dan riwayat asli tidak dihapus oleh optimasi ini.

## Pemasangan dan pemeriksaan

Sumber SQL: `supabase/migrations/0031_daily_reports.sql`, bagian dari `supabase/SETUP.sql`. Pembacaan ringkasan diaktifkan melalui `printex_online_status().daily_summaries_enabled`. Order yang sudah ada dimasukkan ke antrean saat pemasangan dan diproses oleh worker. `tests/production-data.test.mjs` menguji output, intake, rincian, antrean perubahan, dan milestone order yang dihapus.

## Hasil aktivasi 2 Oktober 2026 (masa multi-cabang, sebelum pindah ke satu lokasi)

- 14.011 order dan 166.896 catatan riwayat asli dipertahankan.
- 11.885 baris ringkasan harian tersimpan; antrean awal selesai.
- Perbandingan output, proses, arsip, lebar kertas, durasi, dan produktivitas lolos untuk 12 cabang pada September, 1 September, dan hari ini.
- Akun cabang yang diuji hanya dapat membaca cabangnya sendiri; parameter cabang palsu tidak membuka ringkasan atau rincian cabang lain.
- Contoh 12 September: 396 baris ringkasan, sekitar 61 KB, terbaca sekitar 92 ms pada pengujian koneksi database. Ini bukan pengukuran waktu muat seluruh halaman browser.
- Penjadwal otomatis aktif setiap menit. 166 tes, pemeriksaan tipe, dan build lolos.

Muat ulang browser setelah aktivasi agar kemampuan database yang baru dibaca oleh aplikasi.
