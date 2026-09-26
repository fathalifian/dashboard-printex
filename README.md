# Printex Dashboard

Dashboard internal Next.js untuk order, produksi, laporan, dan operasional cabang. Halaman privat dilindungi login dan `noindex`.

## Pengembangan

Gunakan Node.js 22 dan `npm ci`. Buat `.env.local` berisi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` (atau `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Pengelolaan akun membutuhkan `SUPABASE_SECRET_KEY` atau `SUPABASE_SERVICE_ROLE_KEY` pada server saja. Jangan menaruh secret pada variabel `NEXT_PUBLIC_*` atau commit berkas kredensial.

Jalankan `npm run dev`, lalu buka `http://localhost:3000`.

## Database

Lihat [migrasi cabang produksi](supabase/branch-migrations/README.md). Untuk cabang yang sudah aktif: `npm run db:branch-upgrade -- --existing`, tinjau `supabase/UPGRADE_BRANCHES.sql`, lalu jalankan di Supabase SQL Editor. Perintah generator hanya menulis file lokal.

## Pemeriksaan sebelum deploy

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run check` menjalankan semuanya berurutan.

Tes browser membutuhkan Chrome lokal atau `npx playwright install chromium`. CI GitHub Actions memasang Chromium beserta dependensinya, memakai Node.js 22, menjalankan seluruh pemeriksaan pada push/pull request, dan tidak membutuhkan kredensial produksi. Aktifkan required status check pada aturan branch di GitHub jika ingin memblokir merge yang gagal.

## Operasi

Jalankan `npm start` setelah build. Error halaman menyediakan Coba lagi; error koneksi setelah sinkronisasi awal mencoba mengambil ulang data tanpa menghapus formulir. Perpindahan tahap pada board menggunakan drag-and-drop sesuai hak akses pengguna. Riwayat lengkap dipertahankan untuk perhitungan laporan; sinkronisasi setelah pemuatan pertama hanya mengambil perubahan setelah migrasi 0021.
