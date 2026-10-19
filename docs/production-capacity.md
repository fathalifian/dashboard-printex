# Kapasitas, produktivitas, efisiensi, dan bottleneck

Panel produksi di Dashboard berisi empat tab: **Kapasitas | Produktivitas | Efisiensi | Bottleneck**.
- Tombol **Rincian** menampilkan rumus dan angka yang dipakai.
- Semua angka mengikuti filter **Periode** dan **Lebar** kertas.
- Rumus ditulis sebagai fungsi murni beserta unit test di `src/lib/production-efficiency.ts`, `production-capacity.ts`, dan `production-metrics.ts`.
- Data yang belum dicatat tampil sebagai **"Belum dicatat"**, disertai tooltip yang menjelaskan apa yang perlu diisi.

## Mesin dan waktu kerja

Mesin produksi (standar: Fedar 1, Fedar 2, DTF 1, Press 1) diatur di **Pusat Admin → Mesin produksi**.

Saat order masuk **Proses Sublim**, pengguna memilih mesin print:
- order DTF hanya bisa dicetak di mesin DTF;
- bahan lain dicetak di mesin Fedar.

Waktu kerja diatur di **Pusat Admin → Waktu kerja**:
- **Jam tersedia** = jumlah shift × jam per shift.
- **Jam efektif (T)** = jam tersedia − istirahat & setup. Standar: 1 shift × 9 jam, istirahat & setup 2 jam, sehingga T = 7 jam. Nilai ini dapat diubah kapan saja.
- **Operator standar per hari** (standar: Fedar 1 orang per mesin, DTF 1 orang per mesin, Press 3 orang per mesin, Desain 1). Jam-orang dihitung otomatis = operator × jam efektif setiap hari ada produksi. Hari yang berbeda diubah di **Pusat Admin → Jam operator**.
- **Kecepatan desain** (order/jam, opsional): kapasitas desain = kecepatan × jam efektif (order/hari). Mengaktifkan pilihan "Desain" di tab Bottleneck. Desain dihitung per order, bukan per meter.

## Rumus

**Kapasitas** (per stasiun, lalu per lini):
- P (m/jam) = meter ÷ jam mesin dari catatan Mulai–Selesai pada periode. Tanpa catatan (atau saat filter Lebar dipilih), P memakai lama order di tahap. Mesin tanpa data memakai rata-rata stasiunnya.
- Press DTF memakai lini press sendiri dan tidak dihitung di stasiun Press.
- Kapasitas desain = P × jam tersedia; kapasitas efektif = P × jam efektif.
- Kapasitas stasiun = jumlah kapasitas mesinnya.
- Kapasitas lini Sublim → Press = nilai terendah dari keduanya. DTF dihitung terpisah.
- Utilisasi = output aktual ÷ kapasitas desain.

**Efisiensi** = output aktual ÷ kapasitas efektif, untuk tiap stasiun dan lini.

Status untuk utilisasi dan efisiensi: Rendah < 70%, Cukup 70–80%, Ideal 80–85%, Padat 85–90%, Penuh ≥ 90%.

**Produktivitas** (dari catatan Mulai/Selesai cetak dan jam operator):
- m/jam-mesin = meter yang selesai dicetak ÷ jam mesin berjalan.
- m/jam-orang = output cetak ÷ jam-orang (Fedar, Press, DTF).
- Desain: order/jam-orang = order yang selesai desain ÷ jam-orang desain.
- Order per operator per hari.
- Pertumbuhan = (periode ini − periode lalu) ÷ periode lalu. Periode lalu panjangnya sama dan berakhir tepat sebelum periode terpilih.

**Bottleneck:**
- Beban stasiun = (meter order masuk pada periode + antrean lama yang belum melewati stasiun) ÷ kapasitas efektif periode.
  - Order DTF hanya membebani stasiun DTF.
  - Order lain membebani Sublim dan Press.
- Stasiun dengan beban tertinggi menjadi **bottleneck**. Beban di atas 100% ditandai **kritis**.
- Alur produksi memberi badge "Bottleneck" pada tahap itu, dan rata-rata waktu tunggunya tampil di tooltip.
- Menunggu Pembayaran bukan stasiun produksi; waktunya ditampilkan terpisah sebagai waktu tunggu administrasi.

## Data yang perlu dicatat

| Data | Siapa | Di mana |
|---|---|---|
| Shift, jam per shift, istirahat & setup | Admin / Owner | Pusat Admin → Waktu kerja |
| Mulai cetak / Selesai cetak (juga press) | Operator | Kartu di Board Produksi (Proses Sublim, Proses Press) |
| Operator standar per tahap | Admin / Owner | Pusat Admin → Waktu kerja |
| Hari dengan operator berbeda (opsional) | Admin / Owner | Pusat Admin → Jam operator |
| Kecepatan desain (order/jam), opsional | Admin / Owner | Pusat Admin → Waktu kerja |

Satu mesin hanya dapat mengerjakan satu order sekaligus. Memindahkan kartu ke tahap lain otomatis menutup catatan cetak yang masih terbuka.

## Pemasangan

Tabel dan fungsinya ada di migrasi `0032_production_capacity.sql`, bagian dari `supabase/SETUP.sql`. Lihat urutan pemasangan di [supabase/manual/README.md](../supabase/manual/README.md).
