# SQL yang dijalankan manual di Supabase

Printex sekarang memakai **satu lokasi produksi** (tanpa cabang). Struktur database lengkap ada di satu file: [`../SETUP.sql`](../SETUP.sql), yang disusun otomatis dari [`../migrations`](../migrations) dengan `npm run db:setup`.

Jalankan di **Supabase → SQL Editor → New query**. Buka file di VS Code, tekan Ctrl+A lalu Ctrl+C, tempel di SQL Editor, lalu klik **Run**. Tunggu sampai muncul hasil sebelum lanjut ke langkah berikutnya.

## Pindah dari database cabang (sekali saja)

| Langkah | File | Isi |
|---|---|---|
| 1 | [`1_SIMPAN_DAN_KOSONGKAN.sql`](1_SIMPAN_DAN_KOSONGKAN.sql) | Menyimpan akun dan pengaturan Salatiga sementara, menghapus akun Owner Pusat dan akun cabang lain, lalu mengosongkan seluruh database lama. **Semua order terhapus.** |
| 2 | [`../SETUP.sql`](../SETUP.sql) | Membangun seluruh struktur database satu lokasi. |
| 3 | [`3_PULIHKAN_AKUN_PENGATURAN.sql`](3_PULIHKAN_AKUN_PENGATURAN.sql) | Mengembalikan akun (password tetap), waktu kerja, operator, mesin, link stok, dan nomor Customer Service. |
| 4 | [`4_RESET_DATA_UJI_7_HARI.sql`](4_RESET_DATA_UJI_7_HARI.sql) | Opsional: membuat data uji 7 hari terakhir. Boleh diulang kapan saja. |
| 5 | [`5_RESET_GO_LIVE.sql`](5_RESET_GO_LIVE.sql) | Nanti, sekali, sebelum dipakai sungguhan: mengosongkan semua order. Akun dan pengaturan tetap ada. |

Langkah 1 dibatalkan otomatis bila tidak ada akun **Owner** aktif di Salatiga, agar tidak ada yang terkunci di luar sistem. Setelah langkah 3 atau 4, semua pengguna perlu me-refresh halaman (F5).

## Database baru (project Supabase kosong)

1. Jalankan [`../SETUP.sql`](../SETUP.sql).
2. Buat akun Owner di Authentication → Users, lalu jalankan [`../ACTIVATE_ADMIN.sql`](../ACTIVATE_ADMIN.sql).
3. Opsional: langkah 4 di atas untuk data uji.
