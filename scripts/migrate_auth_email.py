#!/usr/bin/env python3
"""StockTrace V2 — optional migration of ORIGINAL Auth email addresses to unique internal aliases.
Unlike deleting Auth users, this preserves UUIDs, case logs, PIC links, and passwords.
Supabase Auth still REQUIRES unique email/phone identity. Emails are internal only.
Default DRY RUN; executing requires a privately controlled alias domain and a protected backup path.
"""
import os,sys,re,secrets,json,csv,pathlib,argparse,urllib.parse
from admin_reset_password import invoke
PHRASE='MIGRASI_EMAIL_LAMA_STOCKTRACE'

def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--domain',required=True,help='Domain alias internal, e.g. auth.example-owned.id')
    a.add_argument('--backup-private',help='PRIVATE CSV path outside repository / synchronized public folders')
    a.add_argument('--execute',action='store_true')
    a.add_argument('--confirm',default='')
    z=a.parse_args()
    domain=z.domain.lower().strip().lstrip('@')
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]{2,100})\.[a-z]{2,}',domain):sys.exit('Domain alias tidak valid.')
    if domain in ('gmail.com','yahoo.com','outlook.com','hotmail.com','example.com') or domain.endswith('.invalid'):
        sys.exit('Gunakan domain alias valid yang dikendalikan administrator. Domain publik/placeholder tidak diizinkan.')
    if z.execute and (z.confirm!=PHRASE or not z.backup_private):sys.exit('GAGAL: butuh --confirm persis dan --backup-private.')
    base=os.getenv('SUPABASE_URL','').rstrip('/');key=os.getenv('SUPABASE_SERVICE_ROLE_KEY','')
    if not base.startswith('https://') or not key:sys.exit('Siapkan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY pada terminal privat.')
    rows=invoke(base,key,'/rest/v1/users?select=id_user,login_id,nama_lengkap,role&order=login_id.asc')
    if len(rows)!=5 or any(not re.fullmatch(r'NP-(?:STF|LDR)-\d{3}',str(x.get('login_id',''))) for x in rows):sys.exit('GAGAL: harus ada tepat lima ID valid sebelum migrasi.')
    planned=[]
    for r in rows:
        uid=r['id_user'];u=invoke(base,key,'/auth/v1/admin/users/'+urllib.parse.quote(uid,safe=''))
        if not u.get('email') or u.get('id')!=uid:sys.exit('GAGAL: Auth identitas tidak cocok.')
        new_email='st-'+secrets.token_hex(16)+'@'+domain
        planned.append((r['login_id'],uid,u['email'],new_email))
    print('ID YANG DITEMUKAN:',', '.join(x[0] for x in planned))
    print('MODE:', 'UBAH EMAIL LAMA' if z.execute else 'DRY RUN — TIDAK MENGUBAH EMAIL')
    print('ALIAS DOMAIN:',domain)
    if not z.execute:return
    backup=pathlib.Path(z.backup_private).expanduser().resolve()
    if backup.exists():sys.exit('Path backup sudah ada. Gunakan nama baru untuk mencegah overwrite.')
    backup.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(str(backup),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8',newline='') as f:
        writer=csv.writer(f);writer.writerow(['login_id','auth_user_id','old_auth_email','new_auth_email']);writer.writerows(planned)
    print('Cadangan identitas disimpan PRIVAT:',backup)
    for login,uid,old,new in planned:
        invoke(base,key,'/auth/v1/admin/users/'+urllib.parse.quote(uid,safe=''),'PUT',{'email':new,'email_confirm':True})
        check=invoke(base,key,'/auth/v1/admin/users/'+urllib.parse.quote(uid,safe=''))
        if check.get('email')!=new:sys.exit('BERHENTI: verifikasi email gagal untuk '+login+'; gunakan backup privat untuk pemulihan.')
        print('DIMIGRASIKAN:',login)
    print('SELESAI: verifikasi login semua akun melalui API ID di STAGING. Alamat email internal bukan mailbox Staff.')

if __name__=='__main__':main()
