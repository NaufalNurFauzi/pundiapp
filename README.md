# Pundi — Money Management Planner

Versi lokal (VS Code / Vite) dari aplikasi Pundi yang tadinya berupa artifact React di Claude.ai.

## Cara Menjalankan

1. Buka folder ini di VS Code.
2. Buka terminal (Terminal → New Terminal), lalu jalankan:

   ```bash
   npm install
   npm run dev
   ```

3. Buka browser ke alamat yang muncul di terminal, biasanya `http://localhost:5173`.
   (`npm run dev` juga otomatis membuka tab browser baru.)

Untuk build versi production (menghasilkan folder `dist/` statis yang bisa di-hosting):

```bash
npm run build
npm run preview   # untuk mencoba hasil build-nya secara lokal
```

## Struktur Proyek

```
pundi-app/
├── index.html          # HTML entry point Vite
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.jsx         # entry point React, memuat polyfill storage sebelum App
    ├── App.jsx          # seluruh logika & UI aplikasi Pundi
    ├── index.css        # import Tailwind
    └── lib/
        └── storage.js   # polyfill window.storage → localStorage
```

## Supabase

Aplikasi sekarang memakai Supabase Auth dan PostgreSQL untuk akun, profil, serta
transaksi.

1. Buat project di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, lalu jalankan isi [`supabase/schema.sql`](./supabase/schema.sql)
   dan [`supabase/feedback.sql`](./supabase/feedback.sql).
3. Salin `.env.example` menjadi `.env.local`.
4. Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` dari **Project Settings →
   API**. Gunakan key `anon`/publishable, bukan `service_role`. Isi
   `VITE_APP_URL` dengan URL utama website tanpa garis miring di akhir; URL ini
   dipakai sebagai alamat dasar callback autentikasi.
5. Jalankan `npm run dev`.

### Redirect verifikasi email

Saat pendaftaran, Pundi mengarahkan verifikasi ke
`<VITE_APP_URL>/auth/callback`. Supabase perlu mengizinkan URL tersebut:

1. Buka **Authentication → URL Configuration** di Supabase.
2. Set **Site URL** ke URL utama website, misalnya
   `https://pundi.example.com`.
3. Tambahkan URL callback persis ke **Redirect URLs**, misalnya
   `https://pundi.example.com/auth/callback`. Untuk development, tambahkan
   `http://localhost:5173/auth/callback` dan/atau
   `http://127.0.0.1:5173/auth/callback` sesuai alamat yang dibuka.
4. Di **Authentication → Email Templates → Confirm signup**, pastikan tombol
   konfirmasi memakai `{{ .ConfirmationURL }}` sebagai URL-nya. Supabase akan
   memverifikasi email lalu mengarahkan kembali ke callback aplikasi.
5. Untuk website production, isi `VITE_APP_URL` dengan domain production
   sebelum menjalankan build/deploy. Hosting harus mengarahkan path
   `/auth/callback` ke `index.html` agar aplikasi SPA dapat memuat callback.

Setelah mengubah `.env.local`, restart server Vite. Perubahan URL di dashboard
Supabase berlaku tanpa mengubah kode aplikasi.

### Pengiriman laporan bug dan masukan

Form laporan di Pengaturan menyimpan laporan dan foto opsional langsung ke
Supabase, tanpa mengirim email atau menggunakan Resend. Jalankan isi
[`supabase/feedback.sql`](./supabase/feedback.sql) di **Supabase → SQL Editor**
sekali untuk membuat tabel, bucket foto privat, dan aturan keamanan. Laporan
dapat dilihat di **Table Editor → bug_reports**; lampiran tersimpan di
**Storage → bug-report-attachments**.

### Asisten AI Pundi

Tombol mengambang Asisten Pundi tersedia setelah pengguna login. Asisten
dibatasi untuk pertanyaan tentang fitur Pundi dan pengelolaan keuangan dasar.
Konteks pemasukan, alokasi, target, dan maksimal 20 transaksi terakhir tidak
dikirim kecuali pengguna mencentang persetujuan di ruang chat. Pesan chat tetap
dikirim ke Google Gemini untuk menghasilkan jawaban.

Untuk mengaktifkan layanan:

1. Buat API key di [Google AI Studio](https://aistudio.google.com/apikey), lalu
   tambahkan sebagai secret Supabase (jangan masukkan ke
   `.env.local` atau kode frontend):

   ```bash
   npx supabase secrets set GEMINI_API_KEY=your-gemini-key
   ```

   Fungsi memakai Gemini Interactions API dengan model bawaan
   `gemini-3.8-flash`. Jika perlu memilih model lain yang didukung oleh
   Interactions API dan API key Anda, atur secret secara eksplisit:

   ```bash
   npx supabase secrets set GEMINI_MODEL=gemini-3.8-flash
   ```
2. Deploy fungsi:

   ```bash
   npx supabase functions deploy pundi-assistant
   ```

Jika fungsi menjawab bahwa model tidak tersedia, periksa dukungan model untuk
Interactions API dan akses model oleh project/key Google AI Studio. Simpan nama
model yang didukung sebagai `GEMINI_MODEL`, lalu deploy ulang:

```bash
npx supabase secrets set GEMINI_MODEL=MODEL_DARI_DAFTAR
npx supabase functions deploy pundi-assistant
```

Asisten dapat mengusulkan pencatatan pengeluaran/pemasukan/penarikan, periode
gaji baru, perubahan persentase alokasi, atau target tabungan. Semua usulan
ditinjau dan dikonfirmasi satu per satu sebelum disimpan. Tindakan keuangan
divalidasi lagi di aplikasi; AI tidak dapat menghapus data akun atau transaksi.
Jawaban merupakan panduan umum, bukan nasihat keuangan profesional.

Jika **Confirm email** aktif, pengguna harus memverifikasi email sebelum bisa
masuk. Atur URL redirect di Supabase **Authentication → URL Configuration** ke
URL website production, lalu tambahkan URL callback development jika diperlukan.
Untuk deployment, isi `VITE_APP_URL` dengan URL publik aplikasi, misalnya
`https://pundi.example.com`.

## ⚠️ Penyimpanan Lokal

Versi asli Pundi (di Claude.ai) memakai `window.storage`, sebuah API bawaan
Claude.ai yang datanya tersimpan di server dan bisa diakses dari perangkat lain
dengan login yang sama ("shared storage").

Preferensi tema masih disimpan melalui `src/lib/storage.js` di **`localStorage`
browser**. Data akun dan transaksi tidak lagi disimpan di sana:

- Tema hanya tersimpan di browser/device ini.
- Akun dan transaksi tersinkron antar perangkat melalui Supabase.
- Jika localStorage dibersihkan, hanya preferensi tema yang hilang.
- Fitur "Backup JSON" & "Impor Data" di halaman Pengaturan jadi cara utama untuk
  memindahkan data antar device/browser — export dari satu tempat, import di tempat lain.

## Catatan Teknis Lain

- **Income bulanan bersifat manual, tidak auto-lanjut.** Aplikasi tidak otomatis
  memakai income bulan lalu untuk bulan baru. Begitu kalender masuk bulan baru,
  dashboard tetap menampilkan data ("saldo", alokasi, dsb.) dari bulan terakhir
  yang income-nya sudah dikonfirmasi manual, sampai user klik "Input Income
  Bulan Ini" dan mengisi nominalnya sendiri. Ini disengaja — supaya tidak ada
  angka yang "diam-diam" berubah tanpa sepengetahuan user.
- Password dikelola dan di-hash oleh Supabase Auth; aplikasi tidak menyimpan
  password.
- Ikon pakai [lucide-react](https://lucide.dev/).
- Styling pakai Tailwind (utility classes) + CSS custom (variabel warna, animasi)
  yang didefinisikan langsung di dalam `App.jsx`.
