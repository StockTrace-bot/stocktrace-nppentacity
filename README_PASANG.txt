STOCKTRACE — PERBAIKAN ERROR /api/upload DI VERCEL

ERROR SEBELUMNYA: HTTP 500 non-JSON. Itu indikasi fungsi backend /api/upload gagal.
Paket ini adalah template perbaikan untuk proyek statis HTML + Vercel Functions (BUKAN Next.js).

STRUKTUR:
  index.html
  login.html
  api/
    upload.mjs
  README_PASANG.txt

A. CARA PASANG
1. Salin index.html, login.html, dan folder api/ ke ROOT proyek Vercel.
   Hasil akhirnya harus ada <root>/api/upload.mjs, bukan <root>/public/api/upload.mjs.
2. Bila memakai GitHub → Vercel, commit & push ketiga file, lalu deploy Production.
   Pastikan Vercel Root Directory benar. Jangan pakai rewrite SPA yang menangkap /api/*.
3. Setelah deploy, buka https://<domainmu>/api/upload di browser.
   Harus tampil JSON, misalnya {"ok":true,"configured":false,"missing_settings":[...]}.
   Jika 404 / HTML, route belum terdeploy (periksa path / root directory).
4. Di Vercel → Project → Settings → Environment Variables, isi berikut:
   SUPABASE_URL = URL proyek Supabase yang sama dengan index/login.
   SUPABASE_PUBLISHABLE_KEY = publishable/anon key dari Supabase (bukan service_role).
   GOOGLE_CLIENT_ID = OAuth client milik akun yang berwenang mengunggah ke folder.
   GOOGLE_CLIENT_SECRET = OAuth client secret (RAHASIA, hanya backend).
   GOOGLE_REFRESH_TOKEN = OAuth refresh token yang sah, scope Drive dan offline access (RAHASIA).
   GOOGLE_DRIVE_FOLDER_ID = ID folder Google Drive tujuan yang telah diberi akses akun OAuth.
   Semua env harus diaktifkan untuk Production. Redeploy setelah mengubah env.
5. Google Cloud project terkait harus mengaktifkan Google Drive API. Akun OAuth harus memiliki
   izin editor pada folder tujuan dan OAuth consent sudah selesai. Tanpa itu POST akan gagal.
6. Coba kirim PDF/JPG kecil (<4 MB) memakai akun Supabase Auth yang punya baris public.users
   id_user sesuai auth.users.id, role staff/leader/admin, dan hak SELECT profil sesuai RLS.

B. DIAGNOSIS CEPAT
- /api/upload mengembalikan 404/HTML: route api/upload.mjs tak ikut deploy atau diarahkan rewrite.
- /api/upload GET menampilkan CONFIG_MISSING: Environment Variables belum lengkap.
- POST 401: token sesi Supabase gagal dipakai.
- POST 403: role atau RLS public.users bermasalah.
- POST 502 GOOGLE_OAUTH_ERROR: refresh token / OAuth client tak valid.
- POST 502 GOOGLE_DRIVE_ERROR: folder ID, izin folder, atau Drive API bermasalah.
- POST 500: buka Vercel Dashboard → Project → Logs → filter URL /api/upload.

C. BATASAN PROTOTIPE
- Batas upload kecil: 4 MB. Vercel membatasi seluruh body hingga 4,5 MB.
- Video unboxing besar (10 MB dst.) perlu DIRECT/RESUMABLE upload melalui alur terpisah,
  bukan hanya menaikkan angka maksimum file di HTML.
- Backend hanya mengonfirmasi upload Drive; index.html mengisi tabel Supabase (cases,
  evidence_files, case_logs). Ketiganya butuh skema dan RLS sesuai. Jika salah satu gagal,
  perlu rekonsiliasi kasus/berkas untuk menghindari file Drive tanpa metadata.
- File Drive TIDAK otomatis menjadi publik. Link hanya terbuka bagi akun yang punya izin folder.
- Berkas perusahaan sensitif hanya boleh dipakai jika telah mendapat izin.
- JANGAN menaruh client_secret, refresh token, atau service_role key di index.html/login.html.
- Jangan menganggap fitur siap produksi sebelum pengujian otorisasi/RLS dan penanganan
  penghapusan/perubahan data.

Rujukan resmi:
https://vercel.com/docs/functions/runtimes/node-js
https://vercel.com/docs/functions/limitations
https://developers.google.com/workspace/drive/api/guides/manage-uploads
https://developers.google.com/identity/protocols/oauth2/web-server
