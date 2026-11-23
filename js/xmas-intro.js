// Giant ledge Faye: standalone sprites, loaded only for the seasonal first-visit show.
(async function () {
  if(!document.documentElement.hasAttribute('data-xmas-intro'))return;
  const season=window.KagaSeason,reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if(reduced.matches){season.finishIntro();return;}
  const overlay=document.createElement('section');overlay.id='xmas-intro';
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Faye Christmas surprise');
  overlay.innerHTML='<div class="xi-dim"></div><svg class="xi-curtains" aria-hidden="true"><defs><pattern id="xi-velvet" width="80" height="1" patternUnits="userSpaceOnUse"><path fill="#C8102E" d="M0 0h80v1H0z"/><path fill="#8E0F22" d="M30 0h14v1H30z"/><path fill="#E2354A" d="M44 0h8v1H44z"/></pattern></defs><g class="xi-left"><path class="xi-cloth"/><path class="xi-fur-shade"/><path class="xi-fur"/></g><g class="xi-right"><path class="xi-cloth"/><path class="xi-fur-shade"/><path class="xi-fur"/></g><g class="xi-valance"></g><g class="xi-tassels"></g></svg><div class="xi-cord" hidden></div><canvas class="xi-faye" aria-hidden="true"></canvas><canvas class="xi-cloud" aria-hidden="true" hidden></canvas><div class="xi-bubble" role="status" hidden></div><button class="xi-skip" type="button">ข้าม ›</button>';
  document.body.append(overlay);
  const canvas=overlay.querySelector('.xi-faye'),ctx=canvas.getContext('2d'),cloud=overlay.querySelector('.xi-cloud'),cloudCtx=cloud.getContext('2d'),bubble=overlay.querySelector('.xi-bubble'),cord=overlay.querySelector('.xi-cord'),skip=overlay.querySelector('.xi-skip');
  const focus=document.activeElement,overflow=document.documentElement.style.overflow;
  const inert=[...document.body.children].filter(n=>n!==overlay&&!['SCRIPT','STYLE','LINK'].includes(n.tagName)).map(n=>[n,n.inert]);
  inert.forEach(([n])=>{n.inert=true;});document.documentElement.style.overflow='hidden';skip.focus({preventScroll:true});
  let done=false,raf,timer,releaseWait,watchdog,move=null,curtainMove=null,cloudStart=null,thin=false,gripping=false;
  const animations=new Set(),flights=[];
  function finish(){
    if(done)return;done=true;clearTimeout(timer);clearTimeout(watchdog);cancelAnimationFrame(raf);releaseWait?.();
    animations.forEach(a=>a.cancel());overlay.remove();inert.forEach(([n,value])=>{n.inert=value;});document.documentElement.style.overflow=overflow;
    season.finishIntro();if(focus?.isConnected)focus.focus({preventScroll:true});reduced.removeEventListener('change',motionChange);window.removeEventListener('resize',finish);
  }
  function motionChange(){if(reduced.matches)finish();}
  reduced.addEventListener('change',motionChange);window.addEventListener('resize',finish);skip.onclick=finish;
  overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish();}else if(e.key==='Tab'){e.preventDefault();skip.focus();}});
  watchdog=setTimeout(finish,25000);
  const wait=ms=>new Promise(resolve=>{releaseWait=resolve;timer=setTimeout(resolve,ms);});
  let start;
  async function at(ms,name){await wait(Math.max(0,start+ms-performance.now()));if(done)throw new DOMException('Skipped','AbortError');overlay.dataset.step=name;}
  try{
    const files=['intro-normal-hd','intro-xmas-hd','intro-hurry','intro-props'];
    const images=await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(file));img.src='faye/assets/intro/'+file+'.png?v=2';})));
    if(done)return;
    const [normal,christmas,hurry,props]=images,width=overlay.clientWidth,height=overlay.clientHeight,dpr=window.devicePixelRatio||1;
    // Retain the approved scale for cloud/props; the denser bust uses its nearest legal half-scale.
    const headBlocks=43,pixel=Math.max(1,Math.floor(Math.min(height*.64/41,width*.90/headBlocks)*dpr));
    const size=72*pixel/dpr,left=Math.round((width-size)/2*dpr)/dpr,top=height-75*pixel/dpr;
    const hdPixel=Math.max(1,Math.min(Math.round(pixel/2),Math.floor(width*.90*dpr/86),Math.floor(height*.65*dpr/82)));
    const body={unit:2*hdPixel/dpr,size:144*hdPixel/dpr,left:Math.round((width-144*hdPixel/dpr)/2*dpr)/dpr,top:height-150*hdPixel/dpr};
    canvas.width=144*hdPixel;canvas.height=164*hdPixel;Object.assign(canvas.style,{width:body.size+'px',height:164*hdPixel/dpr+'px',left:body.left+'px',top:body.top+'px'});
    ctx.imageSmoothingEnabled=false;
    const gripsCanvas=document.createElement('canvas');gripsCanvas.className='xi-faye';gripsCanvas.width=canvas.width;gripsCanvas.height=canvas.height;
    Object.assign(gripsCanvas.style,{width:body.size+'px',height:164*hdPixel/dpr+'px',left:body.left+'px',top:body.top+'px',zIndex:'5'});overlay.append(gripsCanvas);
    const gripsCtx=gripsCanvas.getContext('2d');gripsCtx.imageSmoothingEnabled=false;
    cloud.width=72*pixel;cloud.height=82*pixel;Object.assign(cloud.style,{width:size+'px',height:82*pixel/dpr+'px',left:left+'px',top:top+'px'});cloudCtx.imageSmoothingEnabled=false;
    bubble.style.left=width/2+'px';bubble.style.bottom=Math.min(height-70,Math.round(55*pixel/dpr+20))+'px';
    const svg=overlay.querySelector('svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const valance=svg.querySelector('.xi-valance'),tassels=svg.querySelector('.xi-tassels');
    const ns='http://www.w3.org/2000/svg';
    function path(parent,d,fill,stroke,strokeWidth){const node=document.createElementNS(ns,'path');node.setAttribute('d',d);if(fill)node.setAttribute('fill',fill);if(stroke){node.setAttribute('stroke',stroke);node.setAttribute('stroke-width',strokeWidth);}parent.append(node);return node;}
    const furWidth=width*.06,valanceHeight=Math.max(64,width*.08),tasselGroups=[];
    function fluff(node){
      for(const [color,stroke] of [['#F3DCE4',furWidth],['#FFFFFF',furWidth*.82]]){
        const trim=path(node,'','none',color,stroke);trim.setAttribute('stroke-linecap','round');trim.setAttribute('stroke-linejoin','round');trim.setAttribute('stroke-dasharray',`1 ${furWidth*.62}`);
      }
    }
    path(valance,`M0 0H${width}V${valanceHeight}H0Z`,'url(#xi-velvet)');fluff(valance);
    for(const trim of valance.querySelectorAll('path[stroke]'))trim.setAttribute('d',`M0 ${valanceHeight}H${width}`);
    for(const x of [20,width-20]){
      const group=document.createElementNS(ns,'g');tassels.append(group);tasselGroups.push(group);
      path(group,`M${x-5} ${height*.60}h10v32h-10z`,'#f8bd62','#9b602e',2);
      path(group,`M${x-2} ${height*.60+3}v28`,'none','#ffe0a0',3);
    }
    let arriving=true,topGap=width*.10;
    // A-shaped opening: the bottom corners sweep out first while the top stays near the centre.
    function drawCurtains(progress){
      overlay.dataset.curtain=progress.toFixed(3);
      const slide=arriving?(1-Math.min(1,progress))*(width/2+furWidth):0,bottomY=height-furWidth/2;
      const open=1-Math.max(0,Math.min(1,progress)),centre=width/2+3;
      const openTop=width/2-(topGap+furWidth)/2;
      const topEdge=centre+(openTop-centre)*Math.pow(open,1.15);
      const bottomLead=1-(1-open)**2+.02*Math.sin(open*Math.PI),bottomEdge=centre*(1-bottomLead);
      const bow=width*.025*open,span=bottomY-valanceHeight;
      const c1x=topEdge+(bottomEdge-topEdge)*.33-bow,c2x=topEdge+(bottomEdge-topEdge)*.68-bow;
      const line=`M${topEdge} 0 V${valanceHeight} C${c1x} ${valanceHeight+span*.33},${c2x} ${valanceHeight+span*.68},${bottomEdge} ${bottomY} H0`;
      const shape=`M0 0 H${topEdge} V${valanceHeight} C${c1x} ${valanceHeight+span*.33},${c2x} ${valanceHeight+span*.68},${bottomEdge} ${bottomY} V${height} H0Z`;
      valance.setAttribute('transform',`translate(0,${arriving?-(valanceHeight+furWidth)*(1-Math.min(1,progress)):0})`);
      tasselGroups[0].setAttribute('transform',`translate(${-slide},0)`);tasselGroups[1].setAttribute('transform',`translate(${slide},0)`);
      for(const side of ['left','right']){
        const group=svg.querySelector('.xi-'+side);group.setAttribute('transform',side==='right'?`translate(${width+slide},0) scale(-1,1)`:`translate(${-slide},0)`);
        group.querySelector('.xi-cloth').setAttribute('d',shape);group.querySelector('.xi-cloth').setAttribute('fill','url(#xi-velvet)');
        for(const [name,color,stroke] of [['xi-fur-shade','#F3DCE4',furWidth],['xi-fur','#FFFFFF',furWidth*.82]]){
          const fur=group.querySelector('.'+name);fur.setAttribute('d',line);fur.setAttribute('fill','none');fur.setAttribute('stroke',color);fur.setAttribute('stroke-width',stroke);fur.setAttribute('stroke-linecap','round');fur.setAttribute('stroke-linejoin','round');
          fur.setAttribute('stroke-dasharray',`1 ${furWidth*.62}`);
        }
      }
    }
    const geometry={normal:{grips:[[20,69,29,75],[45,70,54,75]],cord:[[49,59],[50,66]]},christmas:{grips:[[20,70,28,75],[43,70,51,75]],cord:[[51,59],[49,67]]}};
    let curtain=0,offset=height,currentImage=normal,lastGlance=-1;
    function frame(image,index){currentImage=image;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,index%2*576,Math.floor(index/2)*656,576,656,0,0,canvas.width,canvas.height);}
    const snap=value=>Math.round(value*dpr)/dpr;
    function rise(to,duration){move={from:offset,to,start:performance.now(),duration};}
    function curtains(to){if(to===0&&width<=500)topGap=Math.max(width*.10,Math.min(width-furWidth-4,bubble.getBoundingClientRect().width+16));svg.style.visibility='visible';curtainMove={from:curtain,to,start:performance.now(),duration:1000};}
    function render(now){
      if(done)return;
      if(move){const p=Math.min(1,(now-move.start)/move.duration),e=p*p*(3-2*p);offset=move.from+(move.to-move.from)*e;if(p===1)move=null;}
      canvas.style.transform=`translateY(${snap(offset)}px)`;
      if(overlay.dataset.step==='secret'){
        const glance=Math.floor(now/180)%2;
        if(glance!==lastGlance){
          lastGlance=glance;frame(normal,1);
          for(const [x,y,w,h] of [[30,55,4,3],[40,54,3,4]]){
            ctx.save();ctx.scale(hdPixel,hdPixel);
            ctx.fillStyle='#FCD4C4';ctx.fillRect(x*2,y*2,w*2,h*2);
            const eye=x*2+(glance?w*2-4:0);ctx.fillStyle='#08758C';ctx.fillRect(eye,y*2,4,h*2);
            ctx.fillStyle='#36CFE1';ctx.fillRect(eye+1,y*2+1,3,h*2-1);
            ctx.fillStyle='#163B45';ctx.fillRect(eye+1,y*2+1,1,h*2-2);
            ctx.fillStyle='#FFFFFF';ctx.fillRect(eye+2,y*2+1,1,1);ctx.fillRect(eye,y*2+h*2-2,1,1);ctx.restore();
          }
        }
      }
      gripsCtx.clearRect(0,0,gripsCanvas.width,gripsCanvas.height);
      if(gripping)for(const [x0,y0,x1,y1] of geometry[currentImage===christmas?'christmas':'normal'].grips){
        gripsCtx.drawImage(currentImage,576+x0*8,y0*8,(x1-x0)*8,(y1-y0)*8,x0*2*hdPixel,y0*2*hdPixel,(x1-x0)*2*hdPixel,(y1-y0)*2*hdPixel);
      }
      if(curtainMove){const p=Math.min(1,(now-curtainMove.start)/curtainMove.duration),e=p*p*(3-2*p);curtain=curtainMove.from+(curtainMove.to-curtainMove.from)*e;
        const overshoot=curtainMove.to===1?Math.sin(p*Math.PI)*.025:0;drawCurtains(Math.min(1.015,curtain+overshoot));if(p===1){curtain=curtainMove.to;drawCurtains(curtain);if(curtain===1)arriving=false;curtainMove=null;}}
      if(cloudStart!==null){
        cloudCtx.clearRect(0,0,cloud.width,cloud.height);const index=thin?3:Math.floor((now-cloudStart)/130)%3;
        cloudCtx.drawImage(hurry,index%2*288,Math.floor(index/2)*328,288,328,0,0,cloud.width,cloud.height);
        cloud.style.transform=`translateX(${snap(Math.floor((now-cloudStart)/65)%2?3:-3)}px)`;
      }
      for(let i=flights.length-1;i>=0;i--){
        const flight=flights[i],p=Math.min(1,(now-flight.start)/1050);
        if(p===1){flight.node.remove();flights.splice(i,1);continue;}
        const cy=height+flight.size/2-(height+flight.size+8)*p;
        flight.node.style.transform=`translate(${snap(flight.x-flight.size/2)}px,${snap(cy-flight.size/2)}px) rotate(${Math.floor(p*4)*90}deg)`;
      }
      raf=requestAnimationFrame(render);
    }
    function say(text){bubble.textContent=text;bubble.hidden=false;}
    function hand(reached){
      // These positions are audited on the authored 72x82 grid beside the short raised fist.
      const [hx,hy]=geometry[currentImage===christmas?'christmas':'normal'].cord[reached?0:1];
      const x=body.left+hx*body.unit,y=body.top+hy*body.unit;
      cord.hidden=false;cord.style.left=snap(x)+'px';cord.style.top='0';cord.style.height=snap(y)+'px';
    }
    const pieceCache=new Map();
    function pieces(index){
      if(pieceCache.has(index))return pieceCache.get(index);
      const source=document.createElement('canvas');source.width=72;source.height=82;
      const context=source.getContext('2d');context.imageSmoothingEnabled=false;context.drawImage(props,index%2*288,Math.floor(index/2)*328,288,328,0,0,72,82);
      const rgba=context.getImageData(0,0,72,82).data,seen=new Uint8Array(72*82),parts=[];
      for(let seed=0;seed<seen.length;seed++){
        if(seen[seed]||!rgba[seed*4+3])continue;
        const queue=[seed];seen[seed]=1;
        for(let at=0;at<queue.length;at++){
          const p=queue[at],x=p%72,y=Math.floor(p/72);
          for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
            const nx=x+dx,ny=y+dy,n=ny*72+nx;
            if(nx>=0&&nx<72&&ny>=0&&ny<82&&!seen[n]&&rgba[n*4+3]){seen[n]=1;queue.push(n);}
          }
        }
        const xs=queue.map(p=>p%72),ys=queue.map(p=>Math.floor(p/72)),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0+1,h=Math.max(...ys)-y0+1,n=Math.max(w,h);
        const image=document.createElement('canvas');image.width=n;image.height=n;
        const out=image.getContext('2d'),data=out.createImageData(n,n),ox=Math.floor((n-w)/2),oy=Math.floor((n-h)/2);
        for(const p of queue)data.data.set(rgba.subarray(p*4,p*4+4),((Math.floor(p/72)-y0+oy)*n+p%72-x0+ox)*4);
        out.putImageData(data,0,0);parts.push({image,area:queue.length});
      }
      parts.sort((a,b)=>b.area-a.area);pieceCache.set(index,parts);return parts;
    }
    function fly(index){
      // Isolate the actual accessory; approved sheet art and its detached motion marks stay untouched.
      const image=pieces(index)[0].image,c=document.createElement('canvas');c.className='xi-prop';c.dataset.accessory=index;
      c.width=image.width;c.height=image.height;const context=c.getContext('2d');context.imageSmoothingEnabled=false;context.drawImage(image,0,0);
      const unit=Math.max(1,Math.min(pixel,Math.floor(width*.28*dpr/34))),side=image.width*unit/dpr;
      const x=index===1?8+side/2:width-8-side/2;
      Object.assign(c.style,{width:side+'px',height:side+'px',left:'0',top:'0',opacity:'1',transform:`translate(${snap(x-side/2)}px,${height+8}px)`});overlay.append(c);
      flights.push({node:c,start:performance.now(),x,size:side});
    }
    function sparkles(snow=false){
      const c=document.createElement('canvas');c.className='xi-prop';c.dataset.sparkles='true';c.width=Math.round(width*dpr);c.height=Math.round(height*dpr);const cctx=c.getContext('2d');cctx.imageSmoothingEnabled=false;
      const hx=left+15*pixel/dpr,rx=left+58*pixel/dpr,hy=top+24*pixel/dpr,shoulder=top+66*pixel/dpr;
      const positions=[[hx/2,hy+pixel*15/dpr,hx-12],[(rx+width)/2,hy+pixel*18/dpr,width-rx-12],[width/2,hy-Math.max(40,width*.05),width*.4],[hx/2,shoulder,hx-12],[(rx+width)/2,shoulder,width-rx-12]];
      const stars=pieces(3);
      positions.forEach(([x,y,lane],i)=>{
        const image=stars[i%stars.length].image,unit=Math.max(1,Math.floor(Math.min(lane*.65,width*.06)*dpr/image.width)),side=image.width*unit;
        cctx.drawImage(image,Math.round(x*dpr-side/2),Math.round(y*dpr-side/2),side,side);
      });
      if(snow)for(let i=0;i<14;i++){
        const x=(i%2?(rx+width)/2:hx/2)*dpr,y=(hy+((i*31)%(Math.max(1,height-hy))))*dpr,u=Math.max(1,Math.floor(dpr*2));
        cctx.fillStyle=i%2?'#FFFFFF':'#F3DCE4';cctx.fillRect(Math.round(x),Math.round(y),u,3*u);cctx.fillRect(Math.round(x-u),Math.round(y+u),3*u,u);
      }
      // Mask the entire character column, so no sparkle or flake can touch hair, face or shoulders.
      const maskLeft=Math.min(hx,body.left+15*body.unit),maskRight=Math.max(rx,body.left+58*body.unit),maskTop=Math.min(hy,body.top+24*body.unit);
      cctx.clearRect(Math.floor((maskLeft-8)*dpr),Math.floor((maskTop-8)*dpr),Math.ceil((maskRight-maskLeft+16)*dpr),Math.ceil((height-maskTop+8)*dpr));
      Object.assign(c.style,{width:width+'px',height:height+'px',left:'0',top:'0'});overlay.append(c);
      const a=c.animate([{opacity:0},{opacity:1,offset:.25},{opacity:0}],{duration:850,fill:'forwards'});animations.add(a);a.finished.then(()=>{animations.delete(a);c.remove();},()=>{});
    }
    drawCurtains(0);frame(normal,0);raf=requestAnimationFrame(render);start=performance.now();overlay.dataset.step='dim';
    await at(300,'peek');offset=0;frame(normal,0);
    await at(650,'climb');frame(normal,1);gripping=true;offset=33*body.unit;rise(0,850);
    await at(1500,'up');gripping=false;say('เดี๋ยวนะ มีเซอร์ไพรส์!');
    await at(2000,'reach');bubble.hidden=true;frame(normal,2);hand(true);
    await at(2250,'pull');frame(normal,3);hand(false);curtains(1);
    await at(3350,'secret');frame(normal,1);cord.hidden=true;say('…ห้ามแอบดูนะ');
    await at(3850,'duck');bubble.hidden=true;rise(55*pixel/dpr,300);
    await at(4150,'hurry');cloud.hidden=false;cloudStart=performance.now();
    await at(4350,'glasses');fly(0);
    const themeAt=performance.now();await season.applyChristmas();start+=performance.now()-themeAt;if(done)return;
    await at(4750,'hoodie');fly(1);
    await at(5100,'shoe');fly(2);
    await at(5650,'puff');thin=true;
    await at(5900,'xmas-peek');cloud.hidden=true;cloudStart=null;frame(christmas,0);offset=0;
    await at(6200,'xmas-climb');frame(christmas,1);gripping=true;offset=27*body.unit;rise(0,750);
    await at(7000,'smile');gripping=false;sparkles();
    await at(7800,'xmas-reach');frame(christmas,2);hand(true);
    await at(8050,'reveal');frame(christmas,3);hand(false);say('Merry Christmas! 🎄');curtains(0);sparkles(true);
    await at(9150,'wave');cord.hidden=true;
    await at(9450,'sink');bubble.hidden=true;overlay.classList.add('xi-finishing');rise(55*pixel/dpr,450);
    await at(9950,'done');finish();
  }catch(error){if(error?.name!=='AbortError')console.warn('Faye Christmas intro unavailable:',error);finish();}
})();
