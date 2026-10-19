# Printex Dashboard

Dashboard internal Next.js untuk order, produksi, laporan, dan operasional satu lokasi produksi. Halaman privat dilindungi login dan `noindex`.

## Pengembangan

Gunakan Node.js 22 dan `npm ci`. Buat `.env.local` berisi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` (atau `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Pengelolaan akun membutuhkan `SUPABASE_SECRET_KEY` atau `SUPABASE_SERVICE_ROLE_KEY` pada server saja. Jangan menaruh secret pada variabel `NEXT_PUBLIC_*` atau commit berkas kredensial.

Jalankan `npm run dev`, lalu buka `http://localhost:3000`.

## Struktur proyek

```
src/
  app/                 Route Next.js: (auth)/login, (dashboard)/*, (admin)/admin/* Pusat Admin, api/reports
    (admin)/admin/_actions/   Server action pengaturan: akun, mesin, waktu kerja, CS
  components/
    admin/             Kerangka Pusat Admin: menu dan bingkai halaman
    dashboard/         Dashboard satu layar: KPI, alur produksi, kapasitas, output, order
    layout/            Header, sidebar, status online, cakupan data per halaman, provider CS
    orders/            Foto order (tampil, unggah)
    production/        Timer produksi, laporan waktu, shortcut stok
    reports/           Status laporan, laporan produktivitas
    settings/          Panel pengaturan: akun, mesin, waktu kerja, jam operator, link stok, CS
    ui/                Komponen umum: badge, filter tanggal, konfirmasi hapus, error
  lib/                 Logika domain + tes unit (*.test.mjs)
    server/            Layanan & cache laporan (hanya server)
    supabase/          Klien Supabase browser/server/admin
  proxy.ts             Proteksi route (pengganti middleware)
tests/                 Tes integrasi (PGlite, render, route access, browser)
scripts/               Generator SETUP.sql dan audit ukuran database
supabase/
  migrations/          Seluruh migrasi berurutan → digabung ke SETUP.sql (npm run db:setup)
  manual/              SQL sekali jalan: pindah dari database cabang, data uji, reset go-live
  jobs/                Aktivasi job pembersih foto (pg_cron + Vault)
docs/                  Dokumentasi operasional; docs/reference/ = desain awal
```

## Database

Seluruh struktur database ada di `supabase/SETUP.sql`, disusun dari `supabase/migrations` dengan `npm run db:setup` (`npm run check` memastikan file itu selalu sesuai). Urutan menjalankan SQL di Supabase, termasuk pindah dari database cabang lama, ada di [supabase/manual/README.md](supabase/manual/README.md). Perintah generator hanya menulis file lokal.

## Pemeriksaan sebelum deploy

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run check` menjalankan semuanya berurutan.

Tes browser membutuhkan Chrome lokal atau `npx playwright install chromium`. CI GitHub Actions memasang Chromium beserta dependensinya, memakai Node.js 22, menjalankan seluruh pemeriksaan pada push/pull request, dan tidak membutuhkan kredensial produksi. Aktifkan required status check pada aturan branch di GitHub jika ingin memblokir merge yang gagal.

## Operasi

Jalankan `npm start` setelah build. Error halaman menyediakan Coba lagi; error koneksi setelah sinkronisasi awal mencoba mengambil ulang data tanpa menghapus formulir. Perpindahan tahap pada board menggunakan drag-and-drop sesuai hak akses pengguna. Pemuatan order mengikuti cakupan halaman dan periode; sinkronisasi berikutnya mengambil perubahan setelah migrasi 0021. Lihat [pemuatan berdasarkan periode](docs/scoped-dashboard-loading.md) dan [ringkasan laporan harian](docs/daily-report-summaries.md) untuk alur laporan saat ini.

## Dokumentasi

- [Urutan SQL di Supabase](supabase/manual/README.md) dan [catatan setup online](supabase/ONLINE_SETUP.md)
- [Laporan proses online](docs/process-reporting.md)
- [Pemuatan berdasarkan periode](docs/scoped-dashboard-loading.md)
- [Ringkasan laporan harian](docs/daily-report-summaries.md)
- [Kapasitas produksi harian](docs/production-capacity.md)
- [Optimasi sinkronisasi dan indeks](docs/performance-sync.md)
- [Audit pembersihan proyek](docs/project-cleanup.md)

Dokumen di [`docs/reference/`](docs/reference/README.md) merupakan referensi desain awal dan dapat berbeda dari implementasi saat ini.
