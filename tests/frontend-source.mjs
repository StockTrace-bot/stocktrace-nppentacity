import {readFileSync} from 'node:fs';
const bundle=readFileSync(new URL('../assets/app-bundle.js',import.meta.url),'utf8');
export function readFrontend(name){
 const marker='// --- '+name+' ---\n';const start=bundle.indexOf(marker);
 if(start<0)throw Error('Missing source section: '+name);
 const from=start+marker.length;const next=bundle.indexOf('\n// --- ',from);
 return bundle.slice(from,next<0?undefined:next).replace(/\n;\s*$/,'\n');
}
