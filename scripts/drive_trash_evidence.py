#!/usr/bin/env python3
"""StockTrace cleanup of only inventoried, verified Google Drive evidence.
Default is dry run; --execute requires exact --confirm phrase. Moves files to trash,
not permanent delete. Never prints refresh tokens or writes credentials to disk.
Usage: python scripts/drive_trash_evidence.py --csv evidence_files.csv
"""
import argparse,csv,os,json,sys,time,urllib.request,urllib.parse,urllib.error,re

APPROVAL='SAYA_SETUJU_PINDAHKAN_BUKTI_STOCKTRACE_KE_TRASH'
FOLDER_RE=re.compile(r'^[A-Za-z0-9_-]{10,128}$')

def request_json(url,*,method='GET',token=None,body=None,headers=None):
    hdr=dict(headers or {})
    if token:hdr['Authorization']='Bearer '+token
    raw=None if body is None else json.dumps(body).encode()
    if body is not None:hdr['Content-Type']='application/json'
    with urllib.request.urlopen(urllib.request.Request(url,data=raw,headers=hdr,method=method),timeout=30) as r:
        b=r.read()
        return json.loads(b.decode()) if b else {}

def token_from_env():
    required=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN']
    missing=[x for x in required if not os.environ.get(x)]
    if missing:raise RuntimeError('Variabel lingkungan lokal belum siap: '+', '.join(missing))
    post=urllib.parse.urlencode({'client_id':os.environ['GOOGLE_CLIENT_ID'],'client_secret':os.environ['GOOGLE_CLIENT_SECRET'],
      'refresh_token':os.environ['GOOGLE_REFRESH_TOKEN'],'grant_type':'refresh_token'}).encode()
    req=urllib.request.Request('https://oauth2.googleapis.com/token',data=post,method='POST',headers={'Content-Type':'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)['access_token']

def authorized_for_trash(metadata,case_id,folder):
    name=str(metadata.get('name') or '')
    props=metadata.get('appProperties') or {}
    return (not metadata.get('trashed') and folder in (metadata.get('parents') or []) and
            name.startswith(case_id+'__') and
            (str(props.get('stocktrace_case') or '')==case_id or
             str(metadata.get('description') or '')==('StockTrace — bukti kasus '+case_id)))

def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--csv',required=True,help='CSV eksport evidence_files dari Supabase')
    a.add_argument('--execute',action='store_true',help='Lakukan pemindahan ke Google Drive Trash')
    a.add_argument('--confirm',default='',help='Frasa persetujuan yang persis, hanya ketika --execute')
    args=a.parse_args()
    if args.execute and args.confirm!=APPROVAL:sys.exit('GAGAL: konfirmasi tindakan destruktif belum lengkap.')
    folder=os.environ.get('GOOGLE_DRIVE_FOLDER_ID','').strip()
    if not FOLDER_RE.fullmatch(folder):sys.exit('GAGAL: GOOGLE_DRIVE_FOLDER_ID belum disetel dengan benar.')
    with open(args.csv,newline='',encoding='utf-8-sig') as f:
        rows=list(csv.DictReader(f))
    if not rows or not {'drive_file_id','id_kasus'}.issubset(rows[0]):sys.exit('CSV tidak memuat drive_file_id dan id_kasus atau kosong.')
    print('BARIS CSV:',len(rows),'MODE:', 'MOVE TO TRASH' if args.execute else 'DRY RUN')
    if args.execute:print('Tindakan memindahkan file ke Trash (dapat dipulihkan sementara), BUKAN hapus permanen.')
    access=token_from_env(); eligible=0;done=0;ignored=0
    seen=set()
    for row in rows:
        file_id=str(row.get('drive_file_id') or '').strip();case_id=str(row.get('id_kasus') or '').strip()
        if not FOLDER_RE.fullmatch(file_id) or not re.fullmatch(r'ST-[A-Za-z0-9_-]{5,45}',case_id) or file_id in seen:
            print('SKIP metadata tidak valid/duplikat',repr(file_id));ignored+=1;continue
        seen.add(file_id)
        url='https://www.googleapis.com/drive/v3/files/'+urllib.parse.quote(file_id,safe='')+'?'+urllib.parse.urlencode({'fields':'id,name,description,parents,trashed,appProperties','supportsAllDrives':'true'})
        try:m=request_json(url,token=access)
        except urllib.error.HTTPError as e:
            print('SKIP Drive tidak bisa memverifikasi file',file_id,e.code);ignored+=1;continue
        if not authorized_for_trash(m,case_id,folder):
            print('SKIP file tidak sesuai kasus/folder/metadata',file_id);ignored+=1;continue
        eligible+=1
        if not args.execute:print('ELIGIBLE',file_id,case_id,m.get('name',''));continue
        update='https://www.googleapis.com/drive/v3/files/'+urllib.parse.quote(file_id,safe='')+'?supportsAllDrives=true'
        try:request_json(update,method='PATCH',token=access,body={'trashed':True});done+=1;print('TRASHED',file_id)
        except urllib.error.HTTPError as e:print('ERROR Google Drive',file_id,e.code)
    print('SELESAI eligible:',eligible,'trashed:',done,'skipped:',ignored)
    if args.execute and done!=eligible:sys.exit('Sebagian file gagal dipindahkan ke Trash. JANGAN reset metadata/database sebelum ditangani.')

if __name__=='__main__':main()
