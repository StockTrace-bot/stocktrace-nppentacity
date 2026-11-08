#!/usr/bin/env python3
"""Permanent Google Drive deletion ONLY of inventoried StockTrace evidence ALREADY in Trash.
Strict preflight verifies id/case/owner metadata; default DRY RUN. Irreversible.
"""
import os,sys,re,argparse,csv,urllib.request,urllib.parse,urllib.error
from drive_trash_evidence import token_from_env,request_json,FOLDER_RE
CONFIRM='SAYA_SETUJU_HAPUS_PERMANEN_BUKTI_STOCKTRACE'
def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--csv',required=True);a.add_argument('--execute',action='store_true');a.add_argument('--confirm',default='')
    z=a.parse_args()
    if z.execute and z.confirm!=CONFIRM:sys.exit('GAGAL: persetujuan hapus permanen belum diberikan.')
    folder=os.getenv('GOOGLE_DRIVE_FOLDER_ID','').strip()
    if not FOLDER_RE.fullmatch(folder):sys.exit('Folder Drive belum dikonfigurasi.')
    with open(z.csv,newline='',encoding='utf-8-sig') as f:rows=list(csv.DictReader(f))
    if not rows or not {'drive_file_id','id_kasus'}.issubset(rows[0]):sys.exit('CSV inventaris bukti tidak valid.')
    token=token_from_env();seen=set();eligible=[];skipped=0
    for r in rows:
        fid=(r.get('drive_file_id') or '').strip();cid=(r.get('id_kasus') or '').strip()
        if fid in seen or not FOLDER_RE.fullmatch(fid) or not re.fullmatch(r'ST-[A-Za-z0-9_-]{5,45}',cid):skipped+=1;continue
        seen.add(fid)
        url='https://www.googleapis.com/drive/v3/files/'+urllib.parse.quote(fid,safe='')+'?'+urllib.parse.urlencode({'fields':'id,name,description,parents,trashed,appProperties','supportsAllDrives':'true'})
        try:d=request_json(url,token=token)
        except urllib.error.HTTPError as e:print('SKIP tidak dapat diperiksa',fid,e.code);skipped+=1;continue
        props=d.get('appProperties') or {}
        # Parent folder may remain on trashed files, but Drive can also hide it:
        # fail closed if the expected parent is not shown.
        if not d.get('trashed') or folder not in (d.get('parents') or []) or not (d.get('name') or '').startswith(cid+'__') or props.get('stocktrace_case')!=cid:
            print('SKIP metadata/folder/Trash tidak cocok',fid);skipped+=1;continue
        eligible.append((fid,cid))
    print('TERVERIFIKASI UNTUK HAPUS PERMANEN:',len(eligible),'| SKIP:',skipped,'| MODE:', 'EXECUTE' if z.execute else 'DRY RUN')
    if not z.execute:
        for fid,cid in eligible:print('ELIGIBLE',fid,cid)
        return
    if skipped:sys.exit('GAGAL: ada item tidak cocok. Selesaikan sebelum menghapus apa pun.')
    for fid,cid in eligible:
        url='https://www.googleapis.com/drive/v3/files/'+urllib.parse.quote(fid,safe='')+'?supportsAllDrives=true'
        try:request_json(url,method='DELETE',token=token);print('DELETED',fid,cid)
        except urllib.error.HTTPError as e:sys.exit(f'GAGAL file {fid} status {e.code}; jangan reset database sebelum audit selesai.')
if __name__=='__main__':main()
