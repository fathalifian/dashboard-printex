# Roles & Permissions

## 1. Roles

- `customer_service`
- `designer`
- `finance`
- `production`
- `supervisor`
- `superadmin`

## 2. Permission matrix

| Capability | CS | Designer | Finance | Production | Supervisor | Superadmin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| View all orders | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Search/tracking | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create order | ✓ | optional | - | - | ✓ | ✓ |
| Edit customer/order metadata | ✓ | limited | - | limited | ✓ | ✓ |
| Update Design step | limited | ✓ | - | - | ✓ | ✓ |
| Update Production step | - | - | - | ✓ | ✓ | ✓ |
| Mark order complete | - | - | - | ✓ | ✓ | ✓ |
| View finance | summary | summary | ✓ | optional | ✓ | ✓ |
| Edit invoice/payment | - | - | ✓ | - | ✓ | ✓ |
| Generate schedule | view | view | - | ✓ | ✓ | ✓ |
| Override schedule | - | - | - | limited | ✓ | ✓ |
| Manage users/settings | - | - | - | - | limited | ✓ |

## 3. Visibility principle

Semua staff boleh melihat status order yang diperlukan untuk koordinasi internal, tetapi **edit permission mengikuti tanggung jawab**.

Contoh:

- CS dapat melihat `Printing & Press sedang berjalan`, tetapi tidak mengubahnya menjadi selesai.
- Designer dapat melihat payment status ringkas jika dibutuhkan, tetapi tidak mengubah nilai pembayaran.

## 4. Authorization

Jangan hanya menyembunyikan tombol di frontend.

Wajib:

1. Frontend guard — UX.
2. Server-side permission check — security.
3. Supabase RLS — database enforcement.

## 5. RLS concept

- SELECT orders: semua authenticated internal user.
- INSERT orders: CS/supervisor/superadmin.
- UPDATE production progress: role sesuai step.
- UPDATE invoices/payments: finance/supervisor/superadmin.
- DELETE: superadmin only.
