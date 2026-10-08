# Pengurangan ukuran database

Perubahan menjaga order, pelanggan, foto, penugasan desainer pada order, tahap,
waktu proses, laporan, filter, ekspor, dan kontrak JSON dashboard.

- Migrasi `0030_history_without_actors.sql` berhenti menyimpan pelaku gerakan
  (`actor_id`, `actor_name`) serta salinan penugasan yang tidak dibaca dari
  riwayat (`assigned_employee_id`). Data lama dikosongkan. Kolom kompatibilitas
  tetap ada dengan nilai NULL untuk view dan aplikasi yang sudah terpasang.
  Indeks `process_history_actor_time` dihapus karena tidak lagi berguna.
  Guard trigger juga mencegah impor mengisi kembali informasi tersebut.
- `maintenance/compact-history.sql` menggabungkan pasangan keluar/masuk lama
  hanya jika pasangan unik dan identitas order, waktu, pelanggan, SPK, dan cabang
  sama. ID catatan masuk disimpan sebagai `next_event_id`. Pembaca yang sudah
  mendukung transisi ringkas tetap mengembangkan dua peristiwa yang sama.
  Peristiwa ambigu dan pengulangan gerakan yang sungguh terjadi dipertahankan.
- `report-migrations/0002_compact_payloads.sql` memindahkan salinan rincian
  order ke `report_order_payloads`, satu snapshot per order. Kontribusi menyimpan
  penanda `order: null`; RPC menyusun rincian dari snapshot bersama. Isi laporan,
  pencarian, halaman, ekspor, dan nilai agregat tetap sama; pelaku menjadi NULL.
  Snapshot laporan tidak bergantung pada keberadaan order sumber. Perbedaan
  snapshot dalam order yang sama menggagalkan migrasi, bukan ditimpa diam-diam.
- Penanda `printex_row_changes` dipertahankan termasuk penanda penghapusan.
  Menghapus penanda tanpa batas cursor/reset dapat membuat perangkat yang lama
  offline melewatkan perubahan. Pemadatan fisik tabel dan indeks menghilangkan
  ruang kosong tanpa menghapus penanda. Indeks periode, identitas, cabang, dan
  primary key lain tetap dipakai; ukurannya saja bukan bukti bahwa indeks boros.

## Audit dan penerapan

Audit hanya membaca, tidak menjalankan migrasi:

```powershell
node --env-file=.env.local scripts/audit-database-size.mjs
```

Penerapan database aktif terpisah dari pembangunan paket SQL. Jalankan setelah
menyetujui perubahan database dan jendela pemeliharaan:

```powershell
node --env-file=.env.local scripts/compact-database.mjs --execute --reclaim
```

Skrip memastikan proyek cocok, mengambil lock dengan batas tunggu 5 detik,
memblokir worker laporan selama transaksi, menyimpan cadangan lokal di
`build/backups/database-compaction-*/`, lalu membandingkan fingerprint data bisnis,
seluruh peristiwa logis tanpa pelaku, seluruh kontribusi laporan yang disusun
kembali, ringkasan, dan antrean laporan. Selama pemeliharaan, trigger sinkronisasi
riwayat digantikan pencatatan berkelompok dalam transaksi yang sama. Setiap ID
riwayat lama mendapat revisi baru beserta status penghapusan yang benar; semua
penanda diperiksa dan trigger diaktifkan kembali sebelum commit. Trigger antrean
laporan juga dihentikan sementara karena hasil laporan tidak berubah. Ini
menghindari pembaruan clock berulang dan perhitungan laporan yang tidak diperlukan.
Perbedaan menggagalkan transaksi. Cadangan mengandung data
pelanggan dan pelaku lama; folder tidak masuk Git dan harus disimpan privat.

`--reclaim` menjalankan VACUUM FULL setelah commit, satu tabel setiap kali. Ini
mengambil lock eksklusif: akses tabel terkait dapat menunggu selama pemadatan.
Pengosongan kolom/penggabungan baris tanpa langkah ini belum tentu menurunkan
angka Database Size karena ruang lama dapat tetap dialokasikan. Jika langkah
pemadatan gagal, perubahan logis yang sudah commit tetap terpasang; jalankan ulang
saat database lebih sepi. Jangan menganggap kegagalan pemadatan sebagai rollback
perubahan logis. Skrip mencatat ukuran sebelum/sesudah dan tahap yang selesai.

Untuk upgrade baru, kedua migrasi schema disertakan dalam `UPGRADE_BRANCHES.sql`.
Penggabungan riwayat lama dan pemadatan fisik hanya dijalankan oleh skrip
pemeliharaan, tidak otomatis setiap pemasangan ulang paket.

## Audit 2 Oktober 2026 (sebelum penerapan)

- 166.897 baris riwayat, semuanya berisi metadata pelaku; belum ada baris transisi
  ringkas pada saat audit.
- 312.044 kontribusi untuk 14.012 order.
- 77.531 salinan rincian order, sekitar 39,4 MiB JSON rincian order tersalin;
  tidak ditemukan snapshot berbeda pada order yang sama.
- Angka ini bukan ukuran penghematan final. Ukuran final memerlukan penerapan,
  pemadatan fisik, dan pengukuran ulang.

Pengujian lokal membandingkan hasil laporan, total, durasi, peristiwa logis,
pencarian sesudah koreksi, serta akses tabel snapshot. Guard pelaku dan penugasan
order juga diuji. Database aktif belum berubah hanya karena tes lokal dijalankan.

## Penerapan selesai 2 Oktober 2026

Pengguna menyetujui penerapan, cadangan, dan pemadatan database aktif. Percobaan
pertama mencapai statement timeout pada pengosongan pelaku dan rollback seluruh
transaksi. Penerapan kedua memakai penanda sinkronisasi berkelompok; berhasil
commit dan menyelesaikan VACUUM FULL pada empat tabel.

Cadangan penerapan yang berhasil:
`build/backups/database-compaction-2026-10-02T08-12-49-152Z/`.
Cadangan kondisi awal sebelum percobaan pertama:
`build/backups/database-compaction-2026-10-02T08-05-03-143Z/`.

Ukuran berikut mencakup tabel dan indeks. Pembanding memakai kondisi sebelum
percobaan pertama, karena rollback pertama sempat menambah ruang fisik kosong
pada tabel riwayat. Tabel snapshot baru turut dihitung agar penghematan tidak
mengabaikan pemindahan penyimpanan.

| Tabel | Sebelum (MiB) | Sesudah (MiB) |
| --- | ---: | ---: |
| `report_contributions` | 156,77 | 114,08 |
| `process_history` | 89,45 | 55,66 |
| `printex_row_changes` | 77,75 | 56,98 |
| `report_order_payloads` (baru) | 0 | 8,73 |
| Total objek dioptimalkan | 323,97 | 235,45 |

Penghematan bersih: 88,52 MiB (27,32%). Ini bukan total ukuran seluruh database;
objek lain tidak dimasukkan ke perbandingan tersebut.

- 14.012 order, 362 pelanggan, 5 profil, 12 cabang, dan 7 tahap memiliki jumlah
  serta fingerprint isi yang sama sebelum/sesudah commit.
- 166.897 baris riwayat menjadi 97.084 baris dengan 69.813 transisi ringkas;
  fingerprint seluruh 166.897 peristiwa logis tetap sama tanpa metadata pelaku.
- Metadata pelaku tersisa: 0 baris. Trigger guard, antrean laporan, dan
  sinkronisasi aktif kembali.
- 312.044 kontribusi dan hasil ringkasan laporan dipertahankan; fingerprint
  seluruh payload yang disusun kembali sama, dengan pelaku NULL.
- 77.531 referensi rincian order memakai 13.941 snapshot bersama. Salinan
  rincian order penuh pada tabel kontribusi: 0.
- 272.254 penanda sinkronisasi tetap ada, termasuk 160.796 penanda penghapusan.
  Penanda tiap ID riwayat lama diverifikasi sebelum commit.
- Antrean laporan tetap kosong; tidak ada perhitungan ulang massal yang
  diperlukan akibat pemadatan.
- RPC ringkasan berhasil dibaca oleh Owner Pusat untuk 12 cabang. Uji empat akun
  cabang lolos pemeriksaan akses dan parameter cabang palsu.
- Penjadwal laporan tetap aktif setiap menit.
- 41 tes database, migrasi, dan sinkronisasi serta lint skrip penerapan lolos
  setelah penyesuaian pencatatan berkelompok.
