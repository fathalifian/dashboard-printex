# Product Requirements Document (PRD)

## 1. Nama produk

**Printex Order Monitoring System**

## 2. Latar belakang

Printex memiliki beberapa staf administrasi yang bekerja dari komputer berbeda: 2 Customer Service, 2 Designer, dan 1 Admin Keuangan. Informasi order perlu dapat dilihat bersama agar pertanyaan customer tidak bergantung pada komunikasi manual antarstaf.

## 3. Product goal

Membangun aplikasi internal yang menjadi **single source of truth** untuk order customer dari order masuk sampai selesai.

## 4. User utama

| Role | Jumlah awal | Kebutuhan utama |
|---|---:|---|
| Customer Service | 2 | Tambah order, cari order, lihat progres, memberi informasi ke customer |
| Designer | 2 | Melihat order desain, update progres/revisi/desain selesai |
| Admin Keuangan | 1 | Invoice, DP/pelunasan, status transaksi |
| Operator Produksi | Opsional | Update Printing & Press dan status selesai produksi |
| Admin/Supervisor | Opsional | Akses penuh, konfigurasi, override jadwal |

## 5. User stories prioritas

### CS
- Sebagai CS, saya dapat mencari order melalui SPK, customer, atau nomor WhatsApp.
- Sebagai CS, saya dapat melihat proses terakhir dan waktu update terakhir.
- Sebagai CS, saya dapat membuat order baru.
- Sebagai CS, saya dapat melihat estimasi selesai/due date.

### Designer
- Sebagai Designer, saya dapat melihat order yang membutuhkan desain.
- Sebagai Designer, saya dapat mencatat revisi customer.
- Sebagai Designer, saya dapat menandai desain selesai/approved.

### Produksi
- Sebagai Operator, saya dapat melihat urutan produksi hari ini.
- Sebagai Operator, saya dapat memulai dan menyelesaikan proses produksi.
- Sebagai Operator, saya dapat melihat ukuran kertas, meter, jenis proses, dan catatan.

### Keuangan
- Sebagai Admin Keuangan, saya dapat melihat order yang membutuhkan invoice.
- Sebagai Admin Keuangan, saya dapat mengubah status pembayaran.
- Sebagai Admin Keuangan, saya tidak perlu mengubah status produksi.

## 6. MVP scope

### Wajib
- Login
- Dashboard
- Search order
- Semua order
- Tambah/edit order
- Detail order
- Tracking status
- Activity log
- Riwayat order selesai
- Role-based access
- Real-time update
- Jadwal produksi rekomendasi
- Status keuangan sederhana

### Setelah MVP
- WhatsApp API
- Upload file desain
- QR/barcode SPK
- Mesin dan kapasitas detail
- Notifikasi customer otomatis
- Advanced scheduling
- OEE / analytics historis

## 7. KPI keberhasilan

- Waktu CS menemukan status order < 10 detik.
- Tidak perlu komunikasi manual antardepartemen untuk pertanyaan status standar.
- 100% perubahan status memiliki user + timestamp.
- Order terlambat dapat terlihat jelas.
- Order selesai tetap searchable.
- Jadwal harian dapat dibuat tanpa menyusun manual satu per satu.

## 8. Non-goals untuk MVP

- ERP lengkap.
- Accounting penuh.
- Payroll.
- Inventory bahan baku lengkap.
- Customer portal publik.
- Optimasi matematis kompleks sejak versi pertama.
