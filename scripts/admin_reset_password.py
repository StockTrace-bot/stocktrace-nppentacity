#!/usr/bin/env python3
"""StockTrace V2: reset password by authorized LOCAL administrator, no public endpoint.
Default DRY RUN. Requires SQL 05 and 08, and secrets set in local environment.
Never upload secret or generated temporary passwords to GitHub/chat.
"""
import argparse,os,sys,re,json,secrets,string,urllib.request,urllib.parse,urllib.error
APPROVAL='RESET_AKUN_STOCKTRACE_TEROTORISASI'
PAT=re.compile(r'^NP-(?:LDR|STF)-\d{3}$')
def invoke(base,secret,path,method='GET',payload=None):
    body=None if payload is None else json.dumps(payload).encode()
    headers={'apikey':secret,'Authorization':'Bearer '+secret,'Accept':'application/json'}
    if body is not None:headers['Content-Type']='application/json'
    req=urllib.request.Request(base+path,headers=headers,method=method,data=body)
    try:
        with urllib.request.urlopen(req,timeout=25) as res:return json.loads(res.read().decode() or '{}')
    except urllib.error.HTTPError as e:raise RuntimeError(f'API rejected {method} {path.split("?")[0]} (HTTP {e.code})') from None

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--id',required=True,help='NP-STF-001 or NP-LDR-001')
    parser.add_argument('--execute',action='store_true')
    parser.add_argument('--confirm',default='')
    args=parser.parse_args();login=args.id.strip().upper()
    if not PAT.fullmatch(login):sys.exit('ID pengguna tidak valid.')
    if args.execute and args.confirm!=APPROVAL:sys.exit('GAGAL: konfirmasi eksplisit belum diberikan.')
    base=os.getenv('SUPABASE_URL','').rstrip('/');secret=os.getenv('SUPABASE_SERVICE_ROLE_KEY','')
    if not base.startswith('https://') or not secret:sys.exit('Siapkan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY pada lingkungan TERMINAL PRIVAT.')
    q=urllib.parse.urlencode({'select':'id_user,nama_lengkap,role,login_id','login_id':'eq.'+login,'limit':'1'})
    rows=invoke(base,secret,'/rest/v1/users?'+q)
    if not isinstance(rows,list) or len(rows)!=1:sys.exit('GAGAL: akun ID tidak ditemukan / tidak unik.')
    u=rows[0];uid=u['id_user']
    state=invoke(base,secret,'/rest/v1/stocktrace_account_security?'+urllib.parse.urlencode({'select':'id_user,must_change_password','id_user':'eq.'+uid}))
    if not isinstance(state,list) or len(state)!=1:sys.exit('GAGAL: SQL keamanan akun belum dijalankan.')
    print('AKUN:',login,'| Role:',u['role'],'| Nama:',u['nama_lengkap'])
    print('MODE:', 'RESET NYATA' if args.execute else 'DRY RUN (tidak mengubah data)')
    if not args.execute:return
    # Deny data access BEFORE any password change. If update fails, admin must resolve lock.
    update_path='/rest/v1/stocktrace_account_security?id_user=eq.'+urllib.parse.quote(uid,safe='')
    invoke(base,secret,update_path,'PATCH',{'must_change_password':True})
    # Don't print secrets to logs, screenshots, or tickets. User must safely hand off once.
    alphabet=string.ascii_letters+string.digits+'!#%_-'
    temp=''.join(secrets.choice(alphabet) for _ in range(26))
    invoke(base,secret,'/auth/v1/admin/users/'+urllib.parse.quote(uid,safe=''),'PUT',{'password':temp})
    print('PASSWORD SEMENTARA (CATAT PRIVAT, HANYA DITAMPILKAN SEKALI):',temp)
    print('WAJIB: Staff login pakai ID, lalu ganti password di Akun Saya sebelum membuka laporan.')
    print('DILARANG: mengirim password lewat chat publik atau menyimpannya di source code.')

if __name__=='__main__':main()
