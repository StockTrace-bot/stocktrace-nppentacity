/* StockTrace V2.1 — minimal OpenXML .xlsx writer, no third-party CDN or macros.
 * ZIP stored entries + CRC32; uses inline strings; Excel formulas are NEVER emitted.
 * Exposes window.StockTraceXlsx = {create,save}; supports multiple worksheets. */
(function(root){
 'use strict';
 const enc=new TextEncoder();
 const xml=s=>String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 const alpha=index=>{let out='';for(let n=index;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
 const crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
 function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=crcTable[(c^bytes[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
 function sheetXml(rows){
  const maxCol=Math.max(1,...rows.map(r=>r.length));
  const dimension='A1:'+alpha(maxCol)+Math.max(1,rows.length);
  const lines=rows.map((r,ri)=>'<row r="'+(ri+1)+'">'+r.map((v,ci)=>{
   if(v===null||v===undefined||v==='')return '';
   const ref=alpha(ci+1)+(ri+1);
   // Only finite numeric input becomes a numeric cell. Other input is inert literal text.
   if(typeof v==='number'&&Number.isFinite(v))return '<c r="'+ref+'"><v>'+v+'</v></c>';
   return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml(String(v).slice(0,32767))+'</t></is></c>';
  }).join('')+'</row>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
   '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="'+dimension+'"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>'+lines+'</sheetData></worksheet>';
 }
 function u16(arr,x){arr.push(x&255,(x>>>8)&255);}
 function u32(arr,x){arr.push(x&255,(x>>>8)&255,(x>>>16)&255,(x>>>24)&255);}
 function packageZip(entries){
  const all=[],central=[];let offset=0;
  const append=(dest,bytes)=>{for(const v of bytes)dest.push(v);};
  for(const [name,body] of entries){
   const filename=enc.encode(name),bytes=enc.encode(body),crc=crc32(bytes),header=[];
   u32(header,0x04034b50);u16(header,20);u16(header,0x0800);u16(header,0);u16(header,0);u16(header,0);
   u32(header,crc);u32(header,bytes.length);u32(header,bytes.length);u16(header,filename.length);u16(header,0);
   append(all,header);append(all,filename);append(all,bytes);
   const c=[];u32(c,0x02014b50);u16(c,20);u16(c,20);u16(c,0x0800);u16(c,0);u16(c,0);u16(c,0);
   u32(c,crc);u32(c,bytes.length);u32(c,bytes.length);u16(c,filename.length);u16(c,0);u16(c,0);
   u16(c,0);u16(c,0);u32(c,0);u32(c,offset);append(c,filename);append(central,c);
   offset+=header.length+filename.length+bytes.length;
  }
  const centralOffset=all.length;append(all,central);
  const end=[];u32(end,0x06054b50);u16(end,0);u16(end,0);u16(end,entries.length);u16(end,entries.length);
  u32(end,central.length);u32(end,centralOffset);u16(end,0);append(all,end);
  return new Uint8Array(all);
 }
 function create(sheets){
  if(!Array.isArray(sheets)||!sheets.length||sheets.length>10)throw Error('Dibutuhkan 1–10 lembar kerja.');
  const names=new Set();
  sheets.forEach(s=>{if(!s?.name||!/^[^\[\]\*\/\\?:]{1,31}$/.test(s.name)||names.has(s.name))throw Error('Nama worksheet duplikat/tidak valid.');names.add(s.name);if(!Array.isArray(s.rows))throw Error('Baris worksheet tidak valid.');});
  const list=sheets.map((s,i)=>'<sheet name="'+xml(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('');
  const links=sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('');
  const types=sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
  const entries=[
   ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+types+'</Types>'],
   ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+list+'</sheets></workbook>'],
   ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+links+'<Relationship Id="rIdStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
   ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']
  ];
  sheets.forEach((s,i)=>entries.push(['xl/worksheets/sheet'+(i+1)+'.xml',sheetXml(s.rows)]));
  return packageZip(entries);
 }
 function save(sheets,filename){
  const bytes=create(sheets),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a=document.createElement('a');a.href=url;a.download=filename.endsWith('.xlsx')?filename:filename+'.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),12000);
 }
 root.StockTraceXlsx={create,save};
})(globalThis);
