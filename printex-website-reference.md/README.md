# Printex Order Monitoring — Website Reference Docs

Dokumentasi ini adalah **source of truth** untuk membangun website internal **Printex Order Monitoring** berdasarkan prototype Figma Make yang diberikan.

## Tujuan sistem

Menyediakan satu dashboard bersama yang dapat dibuka dari komputer Customer Service, Designer, Admin Keuangan, dan Produksi sehingga setiap orang dapat mengetahui posisi order tanpa perlu bertanya ke bagian lain.

Masalah utama yang diselesaikan:

1. CS dapat menjawab pertanyaan customer seperti **“order saya sekarang sampai mana?”** hanya dengan mencari SPK, nama customer, atau nomor WhatsApp.
2. Designer dapat memperbarui progres desain.
3. Produksi dapat memperbarui progres produksi.
4. Admin keuangan dapat melihat dan memperbarui status invoice/pembayaran.
5. Seluruh perubahan tersimpan sebagai aktivitas/audit trail.
6. Order aktif dapat diolah menjadi rekomendasi jadwal produksi berdasarkan due date, prioritas, dan pengelompokan ukuran kertas.
7. Order selesai tetap tersimpan sebagai riwayat/database.

## Baseline Figma yang dianalisis

Prototype aktif menggunakan:

- React 19 + TypeScript
- Vite
- Tailwind CSS v4
- Lucide React icons
- Font Inter
- Flow aktif prototype: **Order Masuk → Design → Printing & Press → Selesai**
- Filter: Semua, Design, Printing & Press, Selesai, Terlambat
- Search: SPK, customer, nomor WhatsApp
- Scheduling prototype: urgent lebih dahulu, kemudian dikelompokkan berdasarkan lebar kertas 1,2 m → 1,6 m → 1,8 m

> Catatan: ZIP juga menyimpan prototype lama dengan flow lebih detail. Untuk website production, database dibuat fleksibel agar flow bisa berkembang tanpa migrasi besar.

## Target stack production yang direkomendasikan

- **Frontend / Full-stack:** Next.js + TypeScript
- **Styling:** Tailwind CSS
- **Database:** PostgreSQL melalui Supabase
- **Authentication:** Supabase Auth
- **Realtime:** Supabase Realtime
- **Hosting:** Vercel
- **Domain:** custom domain `.id` / `.com` atau subdomain perusahaan

## Urutan membaca dokumentasi

1. [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md)
2. [DESIGN.md](./DESIGN.md)
3. [UI_UX.md](./UI_UX.md)
4. [INFORMATION_ARCHITECTURE.md](./INFORMATION_ARCHITECTURE.md)
5. [DATABASE.md](./DATABASE.md)
6. [WORKFLOW_AND_BUSINESS_RULES.md](./WORKFLOW_AND_BUSINESS_RULES.md)
7. [ROLES_AND_PERMISSIONS.md](./ROLES_AND_PERMISSIONS.md)
8. [API.md](./API.md)
9. [SCHEDULING.md](./SCHEDULING.md)
10. [REALTIME_AND_AUDIT.md](./REALTIME_AND_AUDIT.md)
11. [TECH_ARCHITECTURE.md](./TECH_ARCHITECTURE.md)
12. [DATA_IMPORT.md](./DATA_IMPORT.md)
13. [TESTING.md](./TESTING.md)
14. [DEPLOYMENT_SECURITY.md](./DEPLOYMENT_SECURITY.md)
15. [ROADMAP.md](./ROADMAP.md)
16. [FIGMA_HANDOFF.md](./FIGMA_HANDOFF.md)
17. [IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md)

## Prinsip utama

- **Search-first, bukan chart-first.**
- Satu database pusat, bukan data terpisah per komputer.
- Semua status penting terlihat oleh semua role.
- Hak edit dibatasi berdasarkan tanggung jawab.
- Tidak menghapus order selesai; order menjadi arsip historis.
- Setiap perubahan status harus menghasilkan activity log.
- Scheduler menghasilkan **recommended schedule**, bukan keputusan yang tidak bisa dioverride.
