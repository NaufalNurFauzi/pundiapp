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

## ⚠️ Penting: Penyimpanan Data Berubah dari Versi Artifact

Versi asli Pundi (di Claude.ai) memakai `window.storage`, sebuah API bawaan
Claude.ai yang datanya tersimpan di server dan bisa diakses dari perangkat lain
dengan login yang sama ("shared storage").

Versi lokal ini **tidak** punya backend seperti itu. `src/lib/storage.js`
menyediakan polyfill yang meniru API yang sama (`window.storage.get/set/delete`)
tapi menyimpannya ke **`localStorage` browser** — artinya:

- Data (akun, alokasi, transaksi) hanya tersimpan **di browser & device ini saja**.
- Tidak akan otomatis muncul kalau kamu buka dari browser/komputer lain.
- Kalau localStorage browser dibersihkan (clear site data / mode incognito), data akan hilang.
- Fitur "Backup JSON" & "Impor Data" di halaman Pengaturan jadi cara utama untuk
  memindahkan data antar device/browser — export dari satu tempat, import di tempat lain.

Kalau ke depannya kamu mau data benar-benar tersinkron antar device (multi-user
sungguhan), `src/lib/storage.js` adalah tempat yang tepat untuk diganti — misalnya
diarahkan ke backend sendiri (Node/Express + database) atau layanan seperti
Supabase/Firebase, tanpa perlu mengubah kode di `App.jsx` sama sekali karena
`App.jsx` hanya bergantung pada bentuk `window.storage.get/set/delete`.

## Catatan Teknis Lain

- **Income bulanan bersifat manual, tidak auto-lanjut.** Aplikasi tidak otomatis
  memakai income bulan lalu untuk bulan baru. Begitu kalender masuk bulan baru,
  dashboard tetap menampilkan data ("saldo", alokasi, dsb.) dari bulan terakhir
  yang income-nya sudah dikonfirmasi manual, sampai user klik "Input Income
  Bulan Ini" dan mengisi nominalnya sendiri. Ini disengaja — supaya tidak ada
  angka yang "diam-diam" berubah tanpa sepengetahuan user.
- **Hashing password** memakai `crypto.subtle` (Web Crypto API), yang butuh
  "secure context". Ini otomatis terpenuhi saat akses lewat `localhost` (dev
  server Vite) atau lewat HTTPS saat production. Kalau nanti di-deploy, pastikan
  domainnya pakai HTTPS.
- Ikon pakai [lucide-react](https://lucide.dev/).
- Styling pakai Tailwind (utility classes) + CSS custom (variabel warna, animasi)
  yang didefinisikan langsung di dalam `App.jsx`.
