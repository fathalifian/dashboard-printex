# SQL yang dijalankan manual di Supabase

Printex memakai **satu lokasi produksi: Salatiga** (tanpa cabang, tanpa Owner Pusat). Peran akun: Owner, Admin, Operator.

Jalankan di **Supabase → SQL Editor → New query**. Buka file di VS Code, tekan Ctrl+A lalu Ctrl+C, tempel di SQL Editor, lalu klik **Run**. Tunggu sampai muncul hasil sebelum lanjut ke langkah berikutnya.

| Langkah | File | Isi |
|---|---|---|
| 1 | [`1_RESET_STRUKTUR_DATABASE.sql`](1_RESET_STRUKTUR_DATABASE.sql) | **Menghapus seluruh struktur database lalu membangunnya ulang** dalam satu kali jalan. Akun (password tetap), waktu kerja, operator, mesin, link stok, dan nomor CS dipertahankan. **Semua order terhapus.** Bisa dijalankan dari kondisi apa pun (database cabang lama, database lama, atau reset yang sebelumnya terhenti) dan aman diulang. |
| 2 | [`2_DATA_UJI_7_HARI.sql`](2_DATA_UJI_7_HARI.sql) | Opsional: membuat data uji 7 hari terakhir. Boleh diulang kapan saja. |
| 3 | [`3_RESET_GO_LIVE.sql`](3_RESET_GO_LIVE.sql) | Nanti, sekali, sebelum dipakai sungguhan: mengosongkan semua order. Akun dan pengaturan tetap ada. |

Dari database cabang lama hanya akun dan pengaturan **Salatiga** yang dipertahankan; akun Owner Pusat dan akun cabang lain dihapus. Langkah 1 dibatalkan tanpa perubahan bila tidak ada akun **Owner** aktif yang ikut dipertahankan, agar tidak ada yang terkunci di luar sistem. Setelah langkah 1 atau 2, semua pengguna perlu me-refresh halaman (F5).

## Project Supabase baru (kosong)

1. Jalankan [`1_RESET_STRUKTUR_DATABASE.sql`](1_RESET_STRUKTUR_DATABASE.sql) (atau [`../SETUP.sql`](../SETUP.sql)).
2. Buat akun Owner di Authentication → Users, lalu jalankan [`../ACTIVATE_ADMIN.sql`](../ACTIVATE_ADMIN.sql).

## Sumber file

`1_RESET_STRUKTUR_DATABASE.sql` dan `../SETUP.sql` disusun otomatis oleh `npm run db:setup` dari [`../reset/backup.sql`](../reset/backup.sql), [`../schema`](../schema), dan [`../reset/restore.sql`](../reset/restore.sql). Jangan diedit langsung; `npm run check` memastikan keduanya selalu sesuai sumbernya.
