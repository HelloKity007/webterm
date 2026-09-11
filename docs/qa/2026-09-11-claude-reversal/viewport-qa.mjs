import {Page} from '/media/pgz/DATA-A/user_data/pgz/.nvm/versions/node/v24.12.0/lib/node_modules/@jackwener/opencli/dist/src/browser/page.js';
const p=new Page('webterm-viewport'); p._page='FC21198A813542BA5748AA15393D9183';
const [action,index='0',delta='-300']=process.argv.slice(2);
const n=Number(index);
if(action==='reverse') {
 const point=await p.evaluate(`(()=>{const s=document.querySelectorAll('.terminal-surface')[5];s.querySelector('textarea').focus();const r=s.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.92}})()`);
 await new Promise(r=>setTimeout(r,500));
 const read=()=>p.evaluate(`(()=>{let f=document.querySelectorAll('.terminal-surface')[5];f=f[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];for(;f;f=f.return)for(let h=f.memoizedState;h;h=h.next){const t=h.memoizedState?.current;if(t?.buffer?.active&&t.scrollLines){const b=t.buffer.active;return Array.from({length:t.rows},(_,r)=>b.getLine(r)?.translateToString(true)||'')}}})()`);
 for(let i=0;i<40;i++)await p.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:120});
 const before=await read(),start=Date.now();
 await p.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-120});
 let after,elapsed;
 do{after=await read();elapsed=Date.now()-start;if(JSON.stringify(after)!==JSON.stringify(before))break;await new Promise(r=>setTimeout(r,50));}while(elapsed<3000);
 console.log(JSON.stringify({downEvents:40,reverseResponseMs:elapsed,changed:JSON.stringify(before)!==JSON.stringify(after),before,after}));
} else if(action==='resize') {
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:n,height:Number(delta),deviceScaleFactor:1,mobile:false});
} else if(action==='wheel') {
 const ratio=Number(process.argv[5] || .92);
 const point=await p.evaluate(`(()=>{const r=document.querySelectorAll('.terminal-surface')[${n}].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*${ratio}}})()`);
 const count=Number(process.argv[6] || 1);
 for(let i=0;i<count;i++) {await p.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:Number(delta)});await new Promise(r=>setTimeout(r,160));}
 console.log(JSON.stringify({panel:n+1,point,wheels:count,delta:Number(delta)}));
} else if(action==='audit') {
 console.log(JSON.stringify(await p.evaluate(`(()=>{return [...document.querySelectorAll('.terminal-surface')].map((s,i)=>{
 let f=s[Object.keys(s).find(k=>k.startsWith('__reactFiber'))],t;
 for(;f&&!t;f=f.return){for(let h=f.memoizedState;h;h=h.next){const v=h.memoizedState?.current;if(v?.buffer?.active&&typeof v.scrollLines==='function'){t=v;break;}}}
 const screen=s.querySelector('.xterm-screen'),bar=s.querySelector('.scrollbar.vertical'),slider=bar?.querySelector('.slider'),b=t?.buffer.active;
 return {panel:i+1,surfaceHeight:s.clientHeight,screenHeight:screen.clientHeight,surfaceWidth:s.clientWidth,screenWidth:screen.clientWidth,barWidth:bar?.clientWidth,barColor:slider&&getComputedStyle(slider).backgroundColor,fontSize:t?.options.fontSize,lineHeight:t?.options.lineHeight,cols:t?.cols,rows:t?.rows,viewportY:b?.viewportY,visible:b&&Array.from({length:t.rows},(_,r)=>b.getLine(b.viewportY+r)?.translateToString(true)||'')};
 })})()`)));
} else if(action==='screenshot') {
 await p.screenshot({path:index});
}
