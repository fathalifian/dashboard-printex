# Ringkasan laporan harian

Dashboard, laporan proses, laporan arsip, grafik output, dan produktivitas membaca hasil yang tersimpan per tanggal WIB dan cabang. Pengaturan hanya memuat profil dan metadata cabang. Board, order aktif, waktu berjalan, dan detail order tetap memakai data realtime.

## Penyimpanan dan pembaruan

- `report_daily_summaries`: jumlah order, meter, dan total durasi per tanggal, cabang, metrik, dan kategori. Rentang tanggal menjumlahkan ringkasan harian; rata-rata memakai jumlah durasi dibagi jumlah sampel, bukan rata-rata dari rata-rata.
- `report_contributions`: hasil per order yang sudah dihitung. Rincian laporan membaca tabel ini per halaman 50 baris; ekspor CSV membaca per batch 200 baris. Membuka laporan lama tidak mengunduh seluruh riwayat mentah.
- `report_refresh_queue`: order yang berubah. Trigger order, riwayat, dan perubahan nama customer menambahkan ID ke antrean; tidak menghitung seluruh laporan dalam transaksi penyimpanan order.
- Worker `printex-daily-report-refresh` berjalan setiap menit melalui `pg_cron`, termasuk saat aplikasi tidak dibuka. Pembaca laporan juga memproses maksimal 100 order tertunda. Penguncian advisory mencegah dua worker memperbarui ringkasan secara bersamaan.

Setiap hasil langsung memiliki tanggal WIB. Ketika hari berganti, hasil hari sebelumnya sudah tersimpan dan filter Hari ini berpindah ke tanggal baru. Koreksi order memperbarui kontribusi order tersebut dan selisih ringkasan terkait, sehingga tanggal lama tetap dapat dikoreksi tanpa menghitung ulang semua order.

Tabel turunan tidak dapat dibaca atau ditulis langsung oleh akun pengguna. RPC memeriksa akun aktif dan daftar cabang yang boleh dibaca. Cache browser dipisahkan menurut akun, role, cabang, dan tanggal; permintaan bersama dipakai ulang dan jumlah entri cache dibatasi. Data bisnis dan riwayat asli tidak dihapus oleh optimasi ini.

## Pemasangan dan pemeriksaan

Sumber SQL: `supabase/report-migrations/0001_daily_summaries.sql`, juga disertakan dalam `supabase/UPGRADE_BRANCHES.sql`. Untuk database yang sudah memiliki migrasi cabang dan 0025–0029, pengisian bertahap:

```powershell
node --env-file=.env.local scripts/activate-daily-summaries.mjs --staged --execute
```

Pembacaan ringkasan diaktifkan melalui `printex_online_status().daily_summaries_enabled` setelah pengisian dan perbandingan terhadap perhitungan JavaScript lama berhasil. Mode `--verify-existing --execute` melanjutkan validasi tanpa mengulang pengisian; `--functions-only` memperbarui fungsi tanpa mengubah sumber data. `--rebuild` hanya untuk membangun ulang hasil turunan jika rumusnya memang berubah.

```powershell
node --env-file=.env.local scripts/report-scheduler.mjs --status --reads --isolation
npm run check
```

## Hasil aktivasi 2 Oktober 2026

- 14.011 order dan 166.896 catatan riwayat asli dipertahankan.
- 11.885 baris ringkasan harian tersimpan; antrean awal selesai.
- Perbandingan output, proses, arsip, lebar kertas, durasi, dan produktivitas lolos untuk 12 cabang pada September, 1 September, dan hari ini.
- Akun cabang yang diuji hanya dapat membaca cabangnya sendiri; parameter cabang palsu tidak membuka ringkasan atau rincian cabang lain.
- Contoh 12 September: 396 baris ringkasan, sekitar 61 KB, terbaca sekitar 92 ms pada pengujian koneksi database. Ini bukan pengukuran waktu muat seluruh halaman browser.
- Penjadwal otomatis aktif setiap menit. 166 tes, pemeriksaan tipe, dan build lolos.

Backup dan bukti aktivasi: `build/backups/daily-summaries-2026-10-02T06-05-32-706Z/activation.json`. Muat ulang browser setelah aktivasi agar kemampuan database yang baru dibaca oleh aplikasi.
