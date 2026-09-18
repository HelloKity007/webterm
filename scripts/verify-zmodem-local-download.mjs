import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from '../ui/node_modules/vite/dist/node/index.js';
import {chromium} from '../ui/node_modules/playwright/index.mjs';
const output=resolve('runtime/zmodem-local-download');await mkdir(output,{recursive:true,mode:0o700});
const entry=`
import Z from 'zmodem.js/src/zmodem_browser.js';
import Protocol from 'zmodem.js/src/zsession.js';
import {receiveZmodemDownload} from '${resolve('ui/src/components/terminal/zmodemDownload.ts')}';
window.runTransfer=async()=>{
 const receiver=new Protocol.Session.Receive();
 const sender=Protocol.Session.parse(Array.from('**\\x18B0100000023be50\\r\\n\\x11',c=>c.charCodeAt(0)));
 sender.set_sender(bytes=>queueMicrotask(()=>receiver.consume(bytes)));
 let first=true;receiver.set_sender(bytes=>{if(first){first=false;return;}queueMicrotask(()=>sender.consume(bytes));});
 let received;receiver.on('offer',offer=>{received=receiveZmodemDownload(offer,Z.Browser.save_to_disk);});receiver.start();
 const bytes=Array.from({length:65536},(_,i)=>i%256);
 const transfer=await sender.send_offer({name:'local-contract.bin',size:bytes.length});await transfer.end(bytes);await received;await sender.close();
};`;
const bundle=await build({configFile:false,root:resolve('ui'),plugins:[{name:'qa-zmodem-fixture',resolveId(id){if(id==='virtual:qa-zmodem')return '\0virtual:qa-zmodem';},load(id){if(id==='\0virtual:qa-zmodem')return entry;}}],build:{write:false,minify:false,rollupOptions:{input:'virtual:qa-zmodem',output:{format:'iife',name:'QA'}}}});
const browser=await chromium.launch();const context=await browser.newContext({acceptDownloads:true});
try{const page=await context.newPage();await page.setContent('<title>Owned ZMODEM contract fixture</title>');await page.addScriptTag({content:bundle.output.find(o=>o.type==='chunk').code});const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>window.runTransfer());const d=await downloadPromise;await d.saveAs(resolve(output,'local-contract.bin'));const actual=createHash('sha256').update(await readFile(resolve(output,'local-contract.bin'))).digest('hex');const expected=createHash('sha256').update(Buffer.from(Array.from({length:65536},(_,i)=>i%256))).digest('hex');assert.equal(actual,expected);await writeFile(resolve(output,'report.json'),JSON.stringify({status:'PASS',scope:'local actual installed zmodem Send/Receive plus browser save_to_disk and production download helper; NOT SSH/app e2e',bytes:65536,sha256:actual},null,2));console.log('PASS local actual-library browser download SHA');}finally{await context.close();await browser.close();}
