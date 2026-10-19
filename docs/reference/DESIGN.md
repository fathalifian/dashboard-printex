# Design System

## 1. Design direction

Karakter UI mengikuti prototype Figma:

- Internal enterprise dashboard
- Bersih, ringan, mudah dibaca
- Informasi lebih penting daripada dekorasi
- Desktop-first karena digunakan di komputer admin
- Komponen konsisten dan padat tanpa terasa penuh

## 2. Font

**Inter** sebagai font utama.

```css
font-family: "Inter", sans-serif;
```

Hierarchy yang disarankan:

| Penggunaan | Ukuran | Weight |
|---|---:|---:|
| Page title | 20–24 px | 700 |
| Section title | 16–20 px | 700 |
| Card title | 13–15 px | 600–700 |
| Body | 13–14 px | 400–500 |
| Table header | 11 px | 600 |
| Supporting text | 11–12 px | 400–500 |

## 3. Color tokens

Gunakan Tailwind/slate sebagai neutral base.

```txt
Background App     #F4F6F9
Surface            #FFFFFF
Border             slate-200
Primary            blue-600
Primary Hover      blue-700
Text Main          slate-900
Text Secondary     slate-500
Text Muted         slate-400
```

### Semantic colors

| Makna | Warna |
|---|---|
| Primary / Diproses | Blue |
| Design / Revisi | Violet |
| Menunggu / Warning | Amber |
| Selesai | Emerald |
| Terlambat / Urgent | Red |

## 4. Status badges

```txt
Diproses          bg-blue-50 / text-blue-700 / border-blue-200
Menunggu Produksi bg-amber-50 / text-amber-700 / border-amber-200
Revisi Customer   bg-violet-50 / text-violet-700 / border-violet-200
Selesai           bg-emerald-50 / text-emerald-700 / border-emerald-200
Terlambat         bg-red-50 / text-red-700 / border-red-200
```

## 5. Layout

### Desktop

```txt
┌───────────────┬────────────────────────────────────────────┐
│ Sidebar 224px │ Header 64px                                │
│               ├────────────────────────────────────────────┤
│               │ Page Content                               │
│               │                                            │
└───────────────┴────────────────────────────────────────────┘
```

- Sidebar fixed: 224px (`w-56`)
- Header sticky: 64px
- Main background: `#F4F6F9`
- Content padding: 24px desktop

## 6. Radius & elevation

| Komponen | Radius |
|---|---:|
| Main card | 16px |
| Input | 12px |
| Button | 12px |
| Badge | 6–8px |

Shadow ringan:

```css
box-shadow: 0 1px 3px rgba(0,0,0,.04);
```

## 7. Icons

Gunakan **Lucide React**.

- Sidebar: 17–18px
- Header: 19–22px
- Inline: 14–16px
- KPI: 22–25px

## 8. UX states

Setiap komponen data harus memiliki:

- loading/skeleton
- empty state
- error state
- disabled state
- success feedback
- confirmation jika action penting

## 9. Responsiveness

Target utama desktop ≥ 1024 px.

Tablet/mobile:
- sidebar menjadi drawer
- tabel dapat horizontal scroll
- detail order menjadi stacked layout
- search tetap sticky/terlihat jelas

## 10. Accessibility

- Jangan mengandalkan warna saja; tampilkan label status.
- Kontras minimal WCAG AA untuk teks utama.
- Semua input memiliki label.
- Action button memiliki focus state.
- Status urgent/terlambat memakai icon + text + color.
