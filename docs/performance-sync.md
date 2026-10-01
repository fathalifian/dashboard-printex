# Optimasi sinkronisasi dan indeks

## Realtime dan polling

- Insert/update order, pelanggan, dan riwayat dibatasi `branch_id` untuk akun cabang. Owner Pusat tetap menerima seluruh cabang. Tahapan produksi bersifat global; profil dibatasi ID pengguna yang login.
- DELETE didengarkan tanpa filter karena payload dapat hanya berisi primary key. Browser hanya menyinkronkan jika ID tersebut ada dalam snapshot yang berhak dibaca. RLS dan RPC tetap menjadi pemeriksaan akses utama.
- Langganan diganti ketika cakupan akses berubah; callback langganan lama diabaikan.
- Polling cadangan: 5 menit saat realtime sehat, 30 detik saat realtime gagal atau snapshot error. Notifikasi realtime tetap memicu sinkronisasi dengan debounce 300 ms.
- Tab tersembunyi menghentikan timer polling dan refresh otomatis dari notifikasi. Kembali ke tab, fokus, atau koneksi online memicu satu refresh terkelompok. Permintaan yang sudah berjalan dapat selesai; mutasi eksplisit tetap menyinkronkan hasilnya.

## Audit indeks, 1 Oktober 2026

Query snapshot memakai `WHERE branch_id = ?`, cursor `id > ?`, dan `ORDER BY id LIMIT 1000`. Migrasi `0011_snapshot_indexes.sql` menambahkan `(branch_id, id)` ke orders, customers, dan process_history. Paket upgrade menyertakannya untuk instalasi berikutnya. Pada database aktif, ketiganya telah dipasang dengan `CREATE INDEX CONCURRENTLY` dan diverifikasi valid/ready.

EXPLAIN ANALYZE langsung pada satu cabang menunjukkan order dan riwayat menggunakan indeks baru. Riwayat sebelumnya menyaring 1.231 baris cabang lain untuk mengembalikan 1.000 baris; setelahnya memakai kondisi indeks cabang tanpa penyaringan tersebut. Customers masih memilih indeks branch lama karena sampelnya kecil (18 baris); planner bebas memilih rencana termurah. Tidak ada indeks lama yang dihapus.

Lookup profil/ID perubahan memakai primary key; cursor incremental sudah memiliki indeks revision; stock shortcut sudah memiliki primary key gabungan `(branch_id,id)`. Tidak ditambahkan indeks duplikat untuk query tersebut.

Pengukuran langsung ini bukan benchmark API dengan RLS atau uji 121 pengguna. Waktu respons web juga dipengaruhi jaringan dan layanan paket hosting.

## Foto dan pembersihan

Foto meminta signed URL hanya saat terlihat (IntersectionObserver). Cache memori bersama menggabungkan permintaan bersamaan, mempertahankan URL selama 9 menit dari masa berlaku 10 menit, dan dibersihkan ketika akun berubah. Fokus tab tidak menerbitkan URL baru selama cache valid. Pembaruan URL berhenti saat tab/foto tidak terlihat. Unggahan memakai nama unik dan Cache-Control 3600 agar browser dapat menggunakan kembali file yang sama; tidak ada cache foto privat di localStorage.

Pemindaian foto sisa tidak lagi berjalan pada tiap perangkat. Satu job Supabase Cron `printex-photo-cleanup` berjalan setiap 5 menit, maksimal 50 file per putaran. Foto yang masih dirujuk order selalu dikecualikan. Foto antrean dapat dihapus; unggahan tak terpakai tanpa antrean menunggu 24 jam. Advisory lock dan claim persisten mencegah foto yang akan dihapus dipasang kembali pada order. Kegagalan HTTP dicoba pada putaran selanjutnya. Penghapusan langsung yang terkait aksi ganti/hapus foto tetap dipertahankan agar perilaku aksi pengguna tidak berubah; ini bukan pemindaian berkala.

File dihapus melalui Storage API, bukan DELETE metadata storage. pg_net mengirim setelah transaksi claim commit. [Dokumentasi pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [aturan penghapusan Storage](https://supabase.com/docs/guides/storage/management/delete-objects).

Untuk instalasi baru: isi Vault `printex_storage_url` dengan URL proyek HTTPS dan `printex_storage_cleanup_key` dengan server secret API key proyek (bukan anon key). Sebagai pemilik database, jalankan `supabase/jobs/photo-cleanup.sql`, lalu `supabase/jobs/enable-photo-cleanup.sql`. Jalankan ulang dengan nama job sama untuk memperbarui, bukan membuat duplikat. Rotasi key perlu memperbarui secret Vault tersebut. File job terpisah dari migrasi cabang karena membutuhkan ekstensi Supabase yang tidak tersedia di database pengujian lokal.

Job telah aktif pada database proyek. Uji satu file sementara melalui Storage API menghasilkan HTTP 200 dan objek tidak lagi ada; file serta catatan uji dibersihkan. Kode frontend tetap perlu deployment agar browser memakai optimasi baru.

Pemantauan (hanya database owner):

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname='printex-photo-cleanup';
SELECT status, start_time, end_time FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname='printex-photo-cleanup')
ORDER BY start_time DESC LIMIT 10;
SELECT r.requested_at, h.status_code, h.timed_out
FROM public.photo_cleanup_requests r LEFT JOIN net._http_response h ON h.id=r.request_id
ORDER BY r.requested_at DESC LIMIT 50;
```

Sukses cron berarti permintaan sudah dijadwalkan; status HTTP menunjukkan hasil Storage API. Jangan mencetak isi Vault atau header antrean HTTP. Riwayat HTTP pg_net bersifat sementara; catatan permintaan untuk objek yang sudah hilang dibersihkan setelah 7 hari.
