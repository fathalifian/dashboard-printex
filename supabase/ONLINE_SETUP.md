# Menjalankan mode online

Printex memakai satu lokasi produksi (Salatiga). Seluruh struktur database ada di `supabase/schema/` dan digabung menjadi `SETUP.sql` serta `manual/1_RESET_STRUKTUR_DATABASE.sql` dengan `npm run db:setup`.

## Setup

1. Jalankan `manual/1_RESET_STRUKTUR_DATABASE.sql` di Supabase SQL Editor. File ini dipakai untuk database baru maupun lama, dan akun tetap dipertahankan. Database yang benar-benar kosong juga bisa memakai `SETUP.sql`.
2. Buat akun Owner di Authentication > Users, lalu jalankan `ACTIVATE_ADMIN.sql`.
3. Isi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` (atau `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) di `.env.local` dan di Environment Variables Vercel. Untuk Kelola Akun, tambahkan juga `SUPABASE_SECRET_KEY` (atau `SUPABASE_SERVICE_ROLE_KEY`) tanpa awalan `NEXT_PUBLIC_`. File env tidak masuk Git.
4. Opsional: aktifkan pembersihan foto terjadwal dengan `jobs/enable-photo-cleanup.sql` setelah dua secret Vault diisi.
5. Login ke web, lalu uji perubahan order dari dua browser.

Aplikasi memeriksa `printex_online_status().schema_version` (saat ini 9). Database dengan struktur lama, termasuk versi cabang, menampilkan pesan agar langkah 1 dijalankan.

## Isi `supabase/schema/`

| File | Isi |
|---|---|
| `01_akun.sql` | Profil, peran Owner/Admin/Operator, akun baru nonaktif, dan kelola akun oleh Owner |
| `02_master_produksi.sql` | Tujuh tahap board, mesin (Fedar 1, Fedar 2, DTF 1, Press 1), waktu kerja, dan operator standar |
| `03_order.sql` | Customer, order, riwayat proses, aturan perpindahan dan arsip, serta `printex_mutate_order` dan mesin cetak |
| `04_sinkronisasi.sql` | Snapshot dashboard per periode, sinkronisasi bertahap, dan publikasi realtime |
| `05_foto_order.sql` | Bucket privat `order-photos`, tautan foto, dan antrean pembersihan |
| `06_laporan_harian.sql` | Kontribusi dan total laporan harian, antrean, serta pekerja pg_cron |
| `07_kapasitas_produksi.sql` | Catatan Mulai/Selesai, jam operator per hari, efisiensi, dan produktivitas mesin |
| `08_pengaturan_bersama.sql` | Link stok dan nomor WhatsApp Customer Service |
| `09_pembersihan_foto_terjadwal.sql` | Pembersihan foto lewat pg_net dan Vault |
| `10_hak_akses.sql` | `printex_online_status` dan seluruh hak akses |

### Aturan hak akses

- `anon` tidak mendapat akses apa pun.
- Karyawan aktif hanya bisa **membaca** tabel lewat RLS.
- Order, riwayat, catatan mesin, dan akun diubah lewat fungsi RPC yang memeriksa peran pemanggil.
- Owner/Admin bisa mengubah langsung sebagian kolom pengaturan: mesin, waktu kerja, link stok, dan nomor CS.

## Peran

| Hak akses | Owner | Admin | Operator |
|---|---|---|---|
| Dashboard dan seluruh kolom board | Ya | Ya | Ya |
| Laporan, arsip, detail order, pengaturan | Ya | Ya | Tidak |
| Tambah, edit, hapus, arsip order | Ya | Ya | Tidak |
| Kelola akun dan role | Ya | Tidak | Tidak |
| Pindahkan order | Alur yang berlaku | Alur yang berlaku | Hanya antara Menunggu Pembayaran, Sublim, Press, Order Selesai |

### Login baru dan menghapus akun

- Login baru selalu menjadi Operator nonaktif sampai diaktifkan Owner.
- Menghapus akun dilakukan dalam dua tahap: akses dicabut lebih dulu, lalu login dihapus lewat Auth Admin API. Order dan riwayat tetap tersimpan.
- Bila penghapusan login gagal, akun tetap nonaktif dan tombol Hapus bisa dicoba lagi.

## Alur order

### Perpindahan tahap

- Order hanya pindah satu tahap maju atau mundur.
- Order Masuk boleh langsung ke Menunggu Pembayaran (desain dilewati).
- DTF boleh langsung dari Sublim ke Order Selesai.
- Tahap yang dilewati tidak memiliki riwayat.

### Penyerahan dan arsip

- Penerimaan customer memerlukan konfirmasi penyerahan: diambil, dikirim, atau diterima.
- Pilihan "diterima" langsung masuk Laporan Arsip.
- Order arsip tidak dapat diubah atau dihapus.

### Press DTF

Press DTF memakai lini sendiri. Catatannya tidak dibuat dan tidak dihitung di stasiun Press.

## Foto order

### Unggah dan tampilan

- Owner/Admin menyeret foto ke kartu order di board.
- Foto diperkecil di browser sebelum diunggah: WebP, sisi terpanjang maks. 1.600 piksel, target 200–400 KB.
- File pengganti memakai lokasi baru.
- Foto ditampilkan dengan tautan sementara.

### Pembersihan foto lama

- Foto lama yang diganti, dilepas saat Simpan ke Laporan Arsip, atau milik order yang dihapus masuk antrean pembersihan.
- Server menandai (mengklaim) file dulu, lalu menghapusnya lewat Storage API. File yang sudah diklaim tidak bisa ditautkan lagi.
- Selama aplikasi Owner/Admin terbuka, antrean diproses kira-kira setiap 5 menit. Job terjadwal (langkah 4) memprosesnya walaupun aplikasi tertutup.

## Pemeriksaan lokal

```sh
npm run check
```

Tes database memakai PGlite dan tidak menggantikan uji koneksi dua perangkat ke Supabase asli.
