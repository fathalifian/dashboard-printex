# Data simulasi Printex — 12 cabang

Periode: **2026-09-02 sampai 2026-10-01 (WIB)**. Data operasional lama telah diganti; akun, cabang, pengaturan, mesin, dan tahapan produksi dipertahankan.

Nomor dokumen memakai pola `PTXID` + 8 karakter heksadesimal. Nama pelanggan memakai nama orang, tanpa awalan DUMMY. Catatan order berisi judul file seperti `SUB.011026.637.BU NISA - JERSEY GARUDA.cdr`, jenis kain, panjang layout, serta instruksi cetak. DTF memakai awalan file `DTF`. Data tetap dikenali sebagai simulasi melalui kolom internal `source=simulation` dan tidak boleh digunakan sebagai laporan bisnis nyata.

## Angka acuan sebelum data uji diedit

Pilih seluruh cabang, semua lebar kertas, dan rentang tanggal di atas.

| Cabang | Order | Selesai produksi | Masih aktif | Aktif terlambat | Output print (m) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Demak | 1.290 | 1.235 | 55 | 4 | 40.583 |
| Gunung jati | 900 | 855 | 45 | 4 | 28.135 |
| Jombang | 960 | 918 | 42 | 4 | 29.827,7 |
| Kartasura | 1.080 | 1.033 | 47 | 4 | 34.190,2 |
| Kediri | 1.020 | 974 | 46 | 4 | 32.104 |
| Klaten | 1.140 | 1.094 | 46 | 4 | 36.007,8 |
| Pekalongan | 1.200 | 1.151 | 49 | 4 | 37.738,2 |
| Saladua | 930 | 889 | 41 | 4 | 29.363,5 |
| Salatiga | 1.500 | 1.435 | 65 | 4 | 60.983,5 |
| Semarang | 1.380 | 1.321 | 59 | 4 | 43.063,7 |
| Solo | 1.260 | 1.202 | 58 | 4 | 38.523,1 |
| Surabaya | 1.350 | 1.292 | 58 | 4 | 42.301,9 |
| Total | 14.010 | 13.399 | 611 | 48 | 452.821,6 |

- Salatiga paling banyak; Gunung jati memiliki 900 order.
- 180.154 catatan proses, termasuk revisi dan perpindahan kembali.
- Selesai sebelum tenggat: 12.136; tepat pada tanggal tenggat: 980; melewati tenggat: 283.
- Arsip final: 13.029, terdiri dari 8.368 diambil dan 4.661 dikirim.
- Lima jenis produksi; DTF 0,6 m dan non-DTF 1,2 / 1,6 / 1,8 m. DTF tidak melalui tahap Press.
- Dua foto simulasi per cabang untuk mencoba thumbnail, cache, ganti, dan hapus foto.

Output dihitung dari penyelesaian print pertama setiap order; revisi tidak boleh menggandakan meter. Selesai produksi dan arsip final adalah ukuran berbeda.

## Cadangan dan verifikasi

Cadangan sebelum penggantian berada di `build/backups/printex-before-demo-month-2026-10-01T08-26-07-957Z/`, termasuk 4.628 order lama, pelanggan/riwayat/relasi operasional, 8 foto lama, dan checksum. Folder diabaikan Git. Kredensial dan akun tidak diekspor.

Generator diuji pada 12 cabang di database lokal dan di-rollback. Sebelum commit produksi, hasil modul aplikasi dibandingkan dengan SQL untuk total output, tiap cabang, tren harian, komposisi kertas, jumlah aktif/selesai/terlambat, serta jumlah sampel, meter, dan durasi produktivitas. Semua riwayat berada setelah order masuk dan tidak melewati waktu pengisian. Penanda penghapusan data lama, penanda data baru, dan pengaktifan kembali trigger sinkronisasi diverifikasi. Hash akun/cabang/pengaturan tetap sama.

Laporan mesin: `build/demo-month-report.json`. Verifikasi ulang read-only: `node --env-file=.env.local scripts/verify-live-demo-month.mjs`. Angka acuan berubah setelah order diedit.

## Uji interaksi

1. Bandingkan semua cabang dengan masing-masing dari 12 ruang cabang menggunakan tanggal yang sama.
2. Ganti tanggal harian, mingguan, dan rentang khusus; cocokkan penjumlahan grafik dengan kartu ringkasan.
3. Ganti lebar kertas; DTF tetap tampil dan non-DTF mengikuti pilihan.
4. Cocokkan histori revisi, status aktif, tenggat, dan timer pada detail order.
5. Pindahkan order hari ini, kembali tahap, selesaikan, lalu arsipkan; bandingkan dua sesi pengguna untuk menguji realtime.
6. Uji laporan proses/arsip, pilihan diambil/dikirim, pencarian SPK/nama pelanggan, serta navigasi Back/Forward.
7. Gulir foto, ganti satu foto simulasi, dan hapus foto lain; periksa pembaruan di sesi kedua.
8. Bandingkan akses operator, admin, owner cabang, dan owner pusat.

Pengisian ini menyesuaikan data, bukan mengurangi volume Owner Pusat: totalnya 14.010 order. Kecepatan UI, koneksi lintas perangkat, dan kapasitas pengguna bersamaan memerlukan pengujian terpisah.
