(()=> {
  const base = new URL('.', document.currentScript.src);
  const version = new URL(document.currentScript.src).search; // cache-bust the artwork with the script
  const idle = [
    ['breathe','Breathe','stand',3200],
    ['vibe','Vibing','music',1300],
    ['sleep','Sleeping','sleep',3000],
    ['wake','Wake Up','awake',3075],
    ['game','Gaming','game',1680],
    ['read','Reading','book',3600],
    ['tea','Tea break','tea',2900],
    ['daydream','Daydreaming','stand',2800],
    ['stretch','Stretching','held',2700],
    ['yawn','Yawning','yawn',2950],
    ['peek','Peeking','stand',1800],
    ['hum','Humming','hum',2070],
    ['sway','Swaying','stand',2600],
    ['fidget','Fidgeting','fidget',1770],
    ['page','Turning a page','book',2100],
    ['stargaze','Stargazing','think',3000],
    ['sip','Taking a sip','tea',2240],
    ['snack','Cookie break','snack',2680],
    ['flower','Smelling a flower','flower',3150],
    ['photo','Taking a photo','photo',3000],
    ['strum','Playing ukulele','strum',1920],
    ['plane','Paper plane','plane',2950],
    ['bubble','Blowing bubbles','hum',2400],
    ['rain','Watching the rain','stand',3200],
    ['toeTap','Tapping a foot','stand',1050],
  ];
  const thinking = [
    ['ponder','Pondering','think',2200],
    ['search','Searching','search',2450],
    ['process','Working it out','write',2450],
    ['idea','Lightbulb moment','idea',2100],
  ];
  const reactions = [
    ['hello','Wave hello','wave',1100], ['celebrate','Celebrate','wave',1250],
    ['surprise','Surprised','held',750], ['oops','Oops','think',1100],
    ['grab','Picked up','carry',380], ['drag','Being carried','carry',880],
    ['drop','Landing','stand',540], ['settle','Settling in','stand',620],
    ['shrug','Shrugging','shrug',1100], ['sneeze','Sneezing','sneeze',1250],
    ['letter','Love letter','letter',1900], ['laugh','Laughing','wakeStretch',1400],
    ['yes','Nodding yes','stand',1100], ['no','Shaking his head','stand',900],
    ['blush','Blushing','stand',1650], ['highFive','High five','wave',1000],
  ];
  const actions = Object.freeze(Object.fromEntries([...idle,...thinking,...reactions].map(
    ([id,label,pose,duration])=>[id,Object.freeze({id,label,pose,duration})])));
  const groups = Object.freeze({
    idle:Object.freeze(idle.map(([id])=>id)), thinking:Object.freeze(thinking.map(([id])=>id)),
    reactions:Object.freeze(reactions.map(([id])=>id)),
  });
  const idleCycle=groups.idle.filter(id=>id!=='page'&&id!=='sleep'&&id!=='sip'&&id!=='wake');
  const glyphs = {
    note:['00110','00101','00100','11100','11100'],
    z:['1111','0010','0100','1111'],
    star:['00100','00100','11111','00100','00100'],
    heart:['01010','11111','11111','01110','00100'],
    question:['0110','1001','0010','0100','0000','0100'],
    bang:['11','11','11','00','11'],
    bulb:['0011100','0100010','1000001','1000001','0100010','0011100','0011100','0001000'],
    dot:['11','11'],
    spark:['010','111','010'],
    bubble:['01110','11001','10001','10001','01110'],
    droplet:['01','01','10'],
    planeBody:['00001111','00111110','11111100','00111000','00011000'],
    planeFold:['00000000','00000000','00111000','00010000','00000000'],
    petal:['010','111','010'],
    steam:['010','100','010','001','010'],
    check:['00001','00010','10100','01000'],
  };
  const palette={ink:'#43251d',peach:'#ffa87d',pink:'#ed7c86',blue:'#388aa9',gold:'#ffd79a',cream:'#fff1d7'};
  const atlas = [
    ['prop-motion.png',[
      ['snackBite',164,19,320,558,334,41,320,0],
      ['strumDown',738,19,321,558,334,41,321,0],
      ['planeRelease',137,647,347,557,335,41,320,27],
      ['flowerLow',738,647,321,557,335,41,321,0],
    ]],
    ['extras-a.png',[
      ['snack',165,22,318,554,328,41], ['flower',767,22,318,554,329,41],
      ['photo',165,649,318,553,329,41], ['strum',767,649,320,553,329,41],
    ]],
    ['extras-b.png',[
      ['plane',96,18,388,570,344,41,331,57], ['shrug',721,18,332,570,344,41],
      ['sneeze',124,656,353,581,356,41,335,18], ['letter',645,658,418,579,348,41,338,80],
    ]],

    ['eye-rub.png',[['eyeRub',155,56,792,1248,804,27]]],
    ['wake.png',[
      ['awake',242,41,518,816,531,27],
      ['wakeStretch',1027,41,520,816,531,27],
    ]],
    ['thinking.png',[
      ['search',116,22,340,568,346,41,329,0], ['write',730,21,324,569,341,41],
      ['writeUp',129,678,325,569,338,41], ['idea',717,678,324,569,334,41],
    ]],
    ['idle-details.png',[
      ['hum',292,15,285,466,292,41],
      ['fidget',932,15,285,466,292,41],
      ['pageLift',292,526,286,467,289,29],
      ['pageSweep',932,525,286,468,290,29],
    ]],
    ['carry.png',[['carry',214,41,772,947]]],
    ['yawn.png',[['yawn',297,97,660,1088,688,41]]],
    ['faye.png',[['stand',298,98,659,1086,690,41]]],
    ['crouch.png',[['crouch',297,103,660,1051,681,35]]],
    ['poses-a.png',[
      ['sleep',291,21,296,450,300,27], ['game',936,21,296,451,294,28],
      ['book',290,531,292,462,293,29], ['held',940,516,285,466,285,41],
    ]],
    ['poses-b.png',[
      ['tea',162,11,313,595,320,41], ['music',712,11,318,595,331,41],
      ['think',154,673,317,595,315,41], ['wave',672,673,361,595,324,41,317,44],
    ]],
  ];
  let imagePromise;
  function loadArt() {
    if (imagePromise) return imagePromise;
    imagePromise = Promise.all(atlas.map(async ([file,sprites])=>{
      const img = new Image();
      img.src = new URL('assets/'+file+version,base);
      await img.decode();
      return sprites.map(([name,l,t,w,h,neck,body,headWidth=w,headLeft=0])=>[
        name,{img,l,t,w,h,neck,body,headWidth,headCenter:headLeft+headWidth/2},
      ]);
    })).then(items=>Object.fromEntries(items.flat())).catch(error=>{imagePromise=undefined;throw error});
    return imagePromise;
  }
  const W=144,H=164, FLOOR=150, TAU=2*Math.PI;
  const seated = new Set(['sleep','game','book','awake','eyeRub','wakeStretch']);
  const grounded = new Set(['stand','tea','music','think','wave','yawn','hum','fidget','search','write','idea','snack','flower','photo','strum','plane','shrug','sneeze','letter']);
  const headPixels=68, headHeight=71;
  // Match the jacket and hips to Breathe. Raised arms and seated knees retain more width.
  const waistScale={crouch:.95,sleep:.91,game:.89,book:.90,held:.85,tea:.84,music:.84,think:.84,wave:.86,yawn:.95,hum:.89,fidget:.87,pageLift:.90,pageSweep:.90,search:.91,write:.89,writeUp:.89,idea:.90,awake:.91,eyeRub:.91,wakeStretch:.93,snack:.91,flower:.89,photo:.91,strum:.91,plane:.90,shrug:.91,sneeze:.91,letter:.90,snackBite:.91,strumDown:.91,planeRelease:.90,flowerLow:.89};
  // Iris rectangles in the source artwork. The eyelids use neighboring skin colors.
  const eyes={
    snack:[[272,282,27,32,'#ffd2bf'],[347,282,26,32,'#ffd1bf']],
    strum:[[873,909,27,32,'#ffd5c4'],[948,909,27,32,'#ffd2c1']],
    plane:[[265,288,29,33,'#f8d4c2'],[341,288,29,33,'#fad6c8']],
    shrug:[[835,288,29,33,'#f9d6c6'],[912,287,29,34,'#f8d0c2']],
    letter:[[842,928,30,33,'#f7d2c2'],[920,928,29,33,'#fcd5c7']],
    stand:[[517,633,58,69,'#f6d6c9'],[674,632,56,70,'#f5d5c9']],
    crouch:[[516,633,59,72,'#f5d2c7'],[674,633,56,72,'#f6d3c7']],
    game:[[1034,260,26,30,'#fddbcd'],[1104,260,27,30,'#fce1d4']],
    book:[[387,766,27,30,'#f8d9cd'],[456,766,27,30,'#f7e0d6']],
    held:[[1038,731,26,29,'#fed5c4'],[1105,731,26,29,'#fad8cb']],
    search:[[211,291,25,34,'#f5ccc4'],[274,294,26,34,'#f9d1c4']],
    write:[[848,303,27,29,'#f6ccc1'],[918,299,28,31,'#fad3ca']],
    writeUp:[[249,955,26,31,'#f8ccbf'],[319,954,28,31,'#f6d2ca']],
    idea:[[838,931,28,31,'#fcd4c7'],[910,926,29,34,'#fcd0c5']],
    fidget:[[1030,251,26,28,'#facfc1'],[1098,251,26,28,'#fbd4c2']],
    tea:[[266,275,28,31,'#f7d0c2'],[340,275,28,31,'#f9d6c9']],
    think:[[283,937,27,29,'#f9d2c5'],[350,929,27,31,'#fccbbf']],
    wave:[[815,926,30,32,'#fbcec1'],[891,932,29,32,'#f7d0c2']],
    carry:[[455,659,48,45,'#fad1c7'],[596,653,53,48,'#fad2c7']],
  };
  const presses=[[.12,.17,-1],[.22,.27,1],[.32,.36,1],[.52,.58,-1],[.65,.70,1],[.80,.86,-1]];
  const transitionMs=350,sleepMs=6500;
  const wakeFrames=[
    [0,'sleep'],[.14,'awake'],[.21,'awake'],[.29,'eyeRub'],[.43,'eyeRub'],
    [.50,'awake'],[.60,'wakeStretch'],[.69,'wakeStretch'],[.76,'awake'],
    [.85,'crouch'],[.94,'stand'],[1,'stand'],
  ];

  function transitionPose(transition,now) {
    const progress=(now-transition.start)/transitionMs;
    if(progress<.18) return transition.from;
    if(progress<.76) return 'crouch';
    return transition.to;
  }

  // interactive:false leaves the pointer to the page (the admin page moves Faye's
  // whole box itself and calls grab/carry/release so he still dangles and lands).
  // speed < 1 slows every animation, sequence and idle switch (0.6 = 60% speed).
  // rest=[min,max] ms: in auto idle he stands and breathes this long between activities.
  function mount(host,{auto=true,interactive=true,speed=1,rest=null}={}) {
    const t0=performance.now(),rate=speed>0?speed:1;
    const clock=(raw=performance.now())=>t0+(raw-t0)*rate;
    const canvas=document.createElement('canvas');
    canvas.width=W;canvas.height=H;
    if(interactive) {
      canvas.tabIndex=0;
      canvas.setAttribute('role','button');
      canvas.setAttribute('aria-label','Faye. Press Enter to wave, or use the arrow keys to move.');
    } else canvas.setAttribute('aria-hidden','true');
    Object.assign(canvas.style,{position:'absolute',left:'0',top:'0',width:W+'px',height:H+'px',touchAction:'none',cursor:interactive?'grab':'inherit',pointerEvents:interactive?'auto':'none',imageRendering:'pixelated',userSelect:'none',display:'block'});
    const previousPosition=host.style.position;
    if(getComputedStyle(host).position==='static') host.style.position='relative';
    host.append(canvas);
    const ctx=canvas.getContext('2d');
    ctx.imageSmoothingEnabled=false;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const events=new AbortController(),signal=events.signal;
    let art,dead=false,frame,last=0,dirty=true,mode='idle', current=actions.breathe;
    let started=clock(), next=Infinity, x=0,y=0, moved=false, pointer=null, carry=0;
    let idleIndex=1,thinkIndex=0,transition=null,bridge=null,visual=null,afterDrag=null;
    let swing=0,swingVelocity=0,lastTick=null;
    let activity={automatic:auto,linked:false,returning:false},following=null;
    let napping=false,paused=false,resting=false;
    const restFor=()=>rest?rest[0]+Math.random()*Math.max(0,rest[1]-rest[0]):7600;
    const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
    function position(px,py) {
      x=clamp(px,0,Math.max(0,host.clientWidth-W));y=clamp(py,0,Math.max(0,host.clientHeight-H));
      canvas.style.transform='translate('+Math.round(x)+'px,'+Math.round(y)+'px)';
      dirty=true;
    }
    function startBridge(from,to,now,duration,thinking=false) {
      if(!from||reduced.matches) return null;
      if(from.layers.length===1&&from.layers[0].pose===to) return null;
      return {from,to,start:now,duration,thinking};
    }
    function select(id) {
      const now=clock();
      const yawnFinished=current.id==='yawn'&&now-started>=current.duration*.86;
      const wakePose=current.id==='wake'
        ? now-started>=current.duration*.94?'stand':visual?.layers.reduce((a,b)=>a.alpha>b.alpha?a:b).pose
        : null;
      const from=transition?transitionPose(transition,now):yawnFinished?'stand':wakePose??current.pose;
      const to=id==='wake'?'sleep':actions[id].pose;
      const changingCarry=(to==='carry')!==(current.pose==='carry');
      const changingThought=groups.thinking.includes(id)&&grounded.has(from)&&from!==to;
      if(changingCarry) bridge=startBridge(visual,to,now,to==='carry'?245:325);
      else if(changingThought) bridge=startBridge(visual,to,now,280,true);
      else if(bridge?.to!==to) bridge=null;
      const sitDown=(grounded.has(from)||from==='crouch')&&seated.has(to);
      const standUp=(seated.has(from)||from==='crouch')&&grounded.has(to);
      const interruptible=!pointer&&!['grab','drag','drop','hello','celebrate','settle'].includes(id);
      transition=interruptible&&!reduced.matches&&(sitDown||standUp)?{from,to,start:now}:null;
      current=actions[id];started=now+(transition?transitionMs:0);dirty=true;
      host.dispatchEvent(new CustomEvent('faye:state',{detail:{mode,id,label:current.label}}));
    }
    function scheduleActivity(id,{automatic=false,linked=false,returning=false}={}) {
      select(id);
      activity={automatic,linked,returning};
      following=null;
      if(id==='read') following='page';
      if(id==='yawn') following='sleep';
      if(id==='sleep') following=napping?null:'wake';
      if(id==='wake'&&!automatic) following='breathe';
      if(id==='tea'&&!returning) following='sip';
      if(linked&&id==='page'&&!automatic) following='read';
      if(linked&&id==='sip') following='tea';
      const oneCycle=following!==null||id==='wake'||(linked&&id==='page')||returning||groups.reactions.includes(id);
      next=oneCycle?started+(id==='sleep'?sleepMs:current.duration):automatic?started+(mode==='idle'?7600:4000):Infinity;
      if(id==='sleep'&&napping) next=Infinity; // a nap lasts until wake()
    }
    function resume() {
      // Between idle activities: a calm pause (breathing, blinking) before the next one.
      if(mode==='idle'&&rest&&auto&&!resting) {
        resting=true;
        scheduleActivity('breathe',{automatic:true});
        next=started+restFor();
        return;
      }
      resting=false;
      const list=mode==='idle'?idleCycle.filter(id=>!rest||id!=='breathe'):groups.thinking;
      const id=mode==='idle'?list[idleIndex++%list.length]:list[thinkIndex++%list.length];
      scheduleActivity(id,{automatic:auto});
    }
    function play(id) {
      if(!actions[id]) throw new RangeError('Unknown Faye animation: '+id);
      if(pointer) return;
      scheduleActivity(id);
    }
    function setMode(value) {
      if(value!=='idle'&&value!=='thinking') throw new RangeError('Use idle or thinking');
      // Already cycling (or mid-reaction) in this mode: leave him be.
      if(value===mode&&!napping&&(activity.automatic||groups.reactions.includes(current.id))) return;
      mode=value;afterDrag=null;
      if(!pointer&&!napping) resume();
    }
    // Long nap: yawn, curl up and stay asleep until wake() is called.
    function doze() {
      if(napping||pointer) return;
      napping=true;mode='idle';
      scheduleActivity('yawn');
    }
    function wake() {
      if(!napping) return false;
      napping=false;
      if(pointer) return true;
      if(current.id==='sleep') scheduleActivity('wake',{automatic:auto});
      else resume();
      return true;
    }
    // Carry driven from outside (interactive:false).
    function grab() {
      if(pointer) return;
      napping=false;
      pointer={id:'host'};
      afterDrag=groups.reactions.includes(current.id)||['yawn','sleep','wake'].includes(current.id)?null:{id:current.id,...activity};
      following=null;moved=false;carry=0;swing=0;swingVelocity=0;
      select('grab');
    }
    function carryBy(dx) {
      if(!pointer) return;
      if(!moved) {moved=true;select('drag');}
      carry=clamp(dx*.025,-.25,.25);
    }
    function release() {
      if(!pointer) return;
      pointer=null;
      select(moved?'drop':'settle');
      next=started+current.duration;
    }
    function pause(value) {paused=!!value;dirty=true;}
    function mark(name,x,y,color,size=2,alpha=1) {
      ctx.globalAlpha=clamp(alpha,0,1);
      ctx.fillStyle=color;
      glyphs[name].forEach((row,j)=>[...row].forEach((p,i)=>{
        if(p==='1')ctx.fillRect(Math.round(x)+i*size,Math.round(y)+j*size,size,size);
      }));
      ctx.globalAlpha=1;
    }
    function drawEyelids(pose,spr,left,width,headSourceHeight,blink) {
      if(!blink||!eyes[pose]) return;
      const scaleX=width/spr.w,scaleY=headHeight/headSourceHeight;
      for(const [x,y,w,h,skin] of eyes[pose]) {
        const x0=left+Math.ceil((x-spr.l)*scaleX-.5);
        const x1=left+Math.ceil((x+w-spr.l)*scaleX-.5);
        const y0=-headHeight+Math.ceil((y-spr.t)*scaleY-.5);
        const y1=-headHeight+Math.ceil((y+h-spr.t)*scaleY-.5);
        const covered=blink===2?y1-y0:Math.ceil((y1-y0)/2);
        ctx.fillStyle=skin;
        ctx.fillRect(x0,y0,x1-x0,covered);
        ctx.fillStyle='#47271e';
        ctx.fillRect(x0,y0+covered-1,x1-x0,1);
        if(blink===2) ctx.fillRect(x0+1,y0+covered,Math.max(2,x1-x0-2),1);
      }
    }
    function drawGamePress(press) {
      if(!press) return;
      const x=press<0?-9:7;
      ctx.fillStyle='#74bde8';
      ctx.fillRect(x-1,5,2,1);
      ctx.fillStyle='#78453a';
      ctx.fillRect(press<0?x-2:x,6,3,3);
      ctx.fillStyle='#fddcce';
      ctx.fillRect(press<0?x-2:x,7,3,2);
      ctx.fillStyle='#efab98';
      ctx.fillRect(press<0?x:x,8,1,1);
    }
    function drawCarry(spr,flutter,detail) {
      const scale=headPixels/674;
      const chin=771-spr.t;
      const left=-Math.round((549-spr.l)*scale);
      const width=Math.round(spr.w*scale);
      const limbHeight=Math.round((spr.h-chin)*scale);
      ctx.drawImage(spr.img,spr.l,spr.t,spr.w,chin,left,-headHeight,width,headHeight);
      drawEyelids('carry',spr,left,width,chin,detail?.blink);
      for(let row=0;row<limbHeight;row++) {
        const top=chin+Math.floor(row*(spr.h-chin)/limbHeight);
        const bottom=chin+Math.floor((row+1)*(spr.h-chin)/limbHeight);
        const kick=Math.round(flutter*Math.pow(row/limbHeight,1.5));
        ctx.drawImage(spr.img,spr.l,spr.t+top,spr.w,bottom-top,left+kick,row,width,1);
      }
    }
    function drawFrame(frame) {
      ctx.save();
      ctx.translate(Math.round(frame.x),Math.round(frame.y));
      ctx.rotate(frame.tilt);
      ctx.scale(frame.sx,frame.sy);
      // Sum the two pose opacities on the cleared canvas to keep shared pixels solid.
      if(frame.additive) ctx.globalCompositeOperation='lighter';
      for(const {pose,alpha,detail} of frame.layers) {
        ctx.globalAlpha=alpha;
        const spr=art[pose];
        if(pose==='carry') drawCarry(spr,frame.flutter,detail);
        else {
          const scale=headPixels/spr.headWidth;
          const width=Math.round(spr.w*scale);
          const left=-Math.round(spr.headCenter*scale);
          ctx.save();
          const headPose=pose==='pageLift'||pose==='pageSweep'?'book':pose==='strumDown'?'strum':pose;
          const head=art[headPose];
          const headWidth=Math.round(head.w*headPixels/head.headWidth);
          const headLeft=-Math.round(head.headCenter*headPixels/head.headWidth);
          ctx.save();
          if(detail?.headX||detail?.headY) ctx.translate(detail.headX,detail.headY);
          if(detail?.headTilt) ctx.rotate(detail.headTilt);
          ctx.drawImage(head.img,head.l,head.t,head.w,head.neck,headLeft,-headHeight,headWidth,headHeight);
          drawEyelids(headPose,head,headLeft,headWidth,head.neck,detail?.blink);
          if(detail?.blush) {
            const alpha=ctx.globalAlpha;
            ctx.globalAlpha=alpha*detail.blush;
            ctx.fillStyle='#f28c98';
            ctx.fillRect(-13,-9,4,2);ctx.fillRect(9,-9,4,2);
            ctx.globalAlpha=alpha;
          }
          if(pose==='snackBite'&&detail?.chew!==undefined) {
            ctx.fillStyle='#fbd1c1';
            ctx.fillRect(-3,-6,7,4);
            ctx.fillStyle='#63352a';
            ctx.fillRect(-1,-4,3+detail.chew,1);
            if(detail.chew) ctx.fillRect(0,-3,3,1);
          }
          ctx.restore();
          const height=frame.bodyHeight??spr.body;
          ctx.translate(0,height);
          if(height!==spr.body) ctx.scale(1,height/spr.body);
          drawBody(pose,spr,left,width,detail);
          ctx.restore();
          if(pose==='game') drawGamePress(detail?.press);
        }
      }
      ctx.restore();
      visual=frame;
    }
    const mix=(from,to,p)=>from+(to-from)*p;
    const ease=p=>p*p*(3-2*p);
    function drawSprite(pose,dx=0,dy=0,tilt=0,sx=1,sy=1,flutter=0,detail=null) {
      const target={
        layers:[{pose,alpha:1,detail}], x:W/2+dx, y:FLOOR-(art[pose].body??41)+dy, tilt,sx,sy,flutter,
      };
      if(pose==='yawn'&&!reduced.matches) {
        const amount=detail?.yawn??0;
        target.layers=[{pose:'stand',alpha:1-amount,detail},{pose,alpha:amount}]
          .filter(layer=>layer.alpha>.01);
      }
      const page=reduced.matches&&current.id==='page'?'pageSweep':detail?.page;
      if(page) target.layers=[{pose:page,alpha:1,detail}];
      if(pose==='write'&&detail?.pencilUp) target.layers=[{pose:'writeUp',alpha:1,detail}];
      if(detail?.alternate&&detail.amount>0) {
        target.layers=[{pose,alpha:1-detail.amount,detail},{pose:detail.alternate,alpha:detail.amount,detail}]
          .filter(layer=>layer.alpha>.01);
        target.additive=target.layers.length>1;
      }
      if(!bridge||reduced.matches) {drawFrame(target);return;}
      const p=clamp((drawTime-bridge.start)/bridge.duration,0,1);
      if(p===1) {bridge=null;drawFrame(target);return;}
      const progress=ease(p);
      const reveal=bridge.thinking?progress:ease(clamp((p-.22)/.53,0,1));
      const from=bridge.from;
      const weights=new Map(from.layers.map(layer=>[layer.pose,{...layer,alpha:layer.alpha*(1-reveal)}]));
      for(const layer of target.layers) {
        const existing=weights.get(layer.pose)?.alpha??0;
        weights.set(layer.pose,{...layer,alpha:existing+layer.alpha*reveal});
      }
      const layers=[...weights.values()].filter(layer=>layer.alpha>.01);
      const interpolated={layers,additive:bridge.thinking};
      if(from.bodyHeight!==undefined) interpolated.bodyHeight=mix(from.bodyHeight,art[pose].body??41,progress);
      for(const key of ['x','y','tilt','sx','sy','flutter']) interpolated[key]=mix(from[key],target[key],progress);
      // A small wind-up and follow-through keeps the body turn readable, with the face pinned.
      if(!bridge.thinking) interpolated.tilt+=(pose==='carry'?-.13:.11)*Math.sin(p*TAU)*Math.sin(p*Math.PI);
      drawFrame(interpolated);
    }
    // Raise the connected sleeves and mug together. The waist, legs, and feet stay planted.
    function teaRow(row,lift) {
      const amount=row<=7?mix(.42,1,row/7):row<=16?1:Math.max(0,1-(row-16)/13);
      return row-Math.round(lift*amount);
    }
    function drawBody(pose,spr,left,width,detail) {
      const lift=detail?.lift??0;
      const sourceHeight=spr.h-spr.neck;
      const sourceTop=spr.t+spr.neck;
      const waist=waistScale[pose];
      if(!waist) {
        if(detail?.toe) {
          const shoeHeight=6;
          const start=Math.round(sourceHeight*(spr.body-shoeHeight)/spr.body);
          const mid=Math.round(spr.w/2);
          const split=Math.round(width/2);
          ctx.drawImage(spr.img,spr.l,sourceTop,spr.w,start,left,-spr.body,width,spr.body-shoeHeight);
          ctx.drawImage(spr.img,spr.l,sourceTop+start,mid,sourceHeight-start,left,-shoeHeight-detail.toe,split,shoeHeight);
          ctx.drawImage(spr.img,spr.l+mid,sourceTop+start,spr.w-mid,sourceHeight-start,left+split,-shoeHeight,width-split,shoeHeight);
        } else ctx.drawImage(spr.img,spr.l,sourceTop,spr.w,sourceHeight,left,-spr.body,width,spr.body);
        return;
      }
      for(let row=0;row<spr.body;row++) {
        const p=row/(spr.body-1);
        const blend=Math.max(0,Math.min(1,p/.35,(1-p)/.16));
        const scale=1-(1-waist)*blend;
        const top=Math.floor(row*sourceHeight/spr.body);
        const bottom=Math.floor((row+1)*sourceHeight/spr.body);
        const y=lift?teaRow(row,lift):row;
        const end=lift?teaRow(row+1,lift):row+1;
        // The torso stays centered while the sleeve, hand, and bag charm twitch together.
        const handMotion=pose==='fidget'?detail?.fidget:detail?.handMotion;
        const center=pose==='fidget'?.48:.31;
        const twitch=Math.round((handMotion??0)*Math.max(0,1-Math.abs(p-center)/.29));
        if(end>y) ctx.drawImage(spr.img,spr.l,sourceTop+top,spr.w,bottom-top,
          Math.round(left*scale)+twitch,y-spr.body,Math.round(width*scale),end-y);
      }
    }
    const born=clock();
    function drawWake(now) {
      const p=clamp((now-started)/current.duration,0,1);
      if(reduced.matches) {
        drawSprite('awake');
        return;
      }
      const nextIndex=wakeFrames.findIndex(([time])=>time>p);
      const lastIndex=wakeFrames.length-1;
      const index=nextIndex<0?lastIndex:nextIndex-1;
      const [start,from]=wakeFrames[index];
      const [end,to]=wakeFrames[Math.min(index+1,lastIndex)];
      const progress=end===start?1:ease((p-start)/(end-start));
      const bodyHeight=Math.round(mix(art[from].body,art[to].body,progress));
      const layers=from===to?[{pose:from,alpha:1}]:[
        {pose:from,alpha:1-progress},{pose:to,alpha:progress},
      ].filter(layer=>layer.alpha>.01);
      // Only the visible leg/body height changes as the knees straighten. The head stays 71 px tall.
      const rubbing=layers.find(layer=>layer.pose==='eyeRub')?.alpha??0;
      const tilt=.019*rubbing*Math.sin((p-.29)*TAU*15);
      drawFrame({layers,additive:layers.length>1,x:W/2,y:FLOOR-bodyHeight,
        tilt,sx:1,sy:1,flutter:0,bodyHeight});
    }
    let drawTime=0;
    function detailFor(id,p,now) {
      if(reduced.matches) return id==='blush'?{blush:1}:null;
      const clock=(now-born+290)%11200;
      const blinkAge=[1800,5670,9020,9290].map(at=>clock-at).find(age=>age>=0&&age<185);
      const blink=blinkAge===undefined?0:blinkAge>=42&&blinkAge<132?2:1;
      const press=id==='game'?presses.find(([start,end])=>p>=start&&p<end)?.[2]:0;
      let lift=0;
      if(id==='sip') {
        const progress=Math.min((p-.12)/.13,(.60-p)/.15);
        lift=Math.round(10*ease(clamp(progress,0,1)));
      }
      const yawn=id==='yawn'?ease(clamp(Math.min((p-.08)/.15,(.86-p)/.18),0,1)):0;
      const page=id==='page'?(p>=.40&&p<.57?'pageLift':p>=.57&&p<.72?'pageSweep':null):null;
      const fidget=id==='fidget'?2.5*Math.sin(p*TAU*3)*Math.pow(Math.sin(p*Math.PI),2):0;
      const pencilUp=id==='process'&&((p>=.18&&p<.28)||(p>=.43&&p<.52)||(p>=.64&&p<.76));
      const pulse=(start,up,down,end)=>ease(clamp(Math.min((p-start)/(up-start),(end-p)/(end-down)),0,1));
      const beat=Math.sin(p*TAU);
      const headX=id==='no'?Math.round(2*beat*Math.sin(p*Math.PI)):0;
      const nod=id==='yes'?Math.pow(Math.sin(p*Math.PI*2),2):0;
      const headY=id==='yes'?Math.round(3*nod):id==='blush'?Math.round(pulse(.08,.27,.60,.93)):0;
      const headTilt=id==='no'?.12*Math.sin(p*TAU*2)*Math.sin(p*Math.PI):id==='rain'?-.026*beat:0;
      const toe=id==='toeTap'?Math.round(2*Math.max(pulse(.02,.16,.24,.39),pulse(.56,.62,.68,.80))):0;
      const camera=id==='photo'?pulse(.43,.49,.51,.59):0;
      let alternate=null,amount=0;
      switch(id) {
        case 'snack':alternate='snackBite';amount=pulse(.23,.28,.76,.94);break;
        case 'flower':alternate='flowerLow';amount=1-pulse(.12,.29,.57,.84);break;
        case 'strum': {
          const stroke=(p*4)%1;
          alternate='strumDown';amount=ease(clamp(Math.min((stroke-.17)/.10,(.75-stroke)/.20),0,1));break;
        }
        case 'plane':alternate='planeRelease';amount=pulse(.33,.38,.88,.99);break;
        case 'shrug':alternate='stand';amount=1-pulse(.04,.25,.59,.97);break;
        case 'sneeze':alternate='stand';amount=1-pulse(.16,.36,.55,.86);break;
        case 'letter':alternate='stand';amount=1-pulse(.01,.14,.79,.98);break;
        case 'highFive':alternate='stand';amount=1-pulse(0,.26,.49,.91);break;
        case 'laugh':alternate='awake';amount=1-pulse(.10,.23,.72,.98);break;
      }
      const expressiveBlink=lift>=9?2:nod>.9||id==='blush'&&p>.32&&p<.48?1:blink;
      return {blink:expressiveBlink,press,lift,yawn,page,fidget,pencilUp,headX,headY,headTilt,toe,
        alternate,amount,camera,chew:Math.floor(p*20)%2,blush:id==='blush'?pulse(.05,.25,.55,.98):0};
    }

    function draw(now) {
      drawTime=now;
      ctx.clearRect(0,0,W,H);
      if(transition) {
        if(now<started&&!reduced.matches) {
          drawSprite(transitionPose(transition,now));
          return;
        }
        transition=null;
        now=Math.max(now,started);
      }
      const {id,pose,duration}=current;
      if(id==='wake') {drawWake(now);return;}
      const shot=groups.reactions.includes(id)&&id!=='drag';
      const p=reduced.matches?(shot ? .52 : .3):(shot?clamp((now-started)/duration,0,1):((now-started)%duration)/duration);
      const s=Math.sin(p*TAU),c=Math.cos(p*TAU), hop=Math.sin(p*Math.PI);
      let dx=0,dy=0,tilt=0,sx=1,sy=1;
      if(!reduced.matches) switch(id) {
        case 'breathe':tilt=.012*s;break;
        case 'vibe':dy=-5*Math.pow(Math.abs(s),2);tilt=.082*s;break;
        case 'sleep':tilt=.018*c;break;
        case 'game':tilt=.015*Math.sin(p*TAU*2);break;
        case 'read':tilt=.026*s;sy=1+.01*c;break;
        case 'tea':tilt=.012*s;break;
        case 'daydream':tilt=.035*c;dy=-Math.max(0,s)*2;break;
        case 'stretch':sy=1+.068*hop;sx=1-.035*hop;break;
        case 'yawn':tilt=-.07*hop+.027*Math.sin(p*TAU*2)*hop;break;
        case 'peek':dx=5*s;tilt=.055*s;break;
        case 'hum':tilt=.023*s;break;
        case 'sway':dx=4*s;break;
        case 'fidget':tilt=.012*s;break;
        case 'page':tilt=-.018*Math.sin(p*Math.PI);break;
        case 'stargaze':tilt=-.06+.025*s;break;
        case 'sip':tilt=.018*s;break;
        case 'ponder':tilt=-.046+.028*s;break;
        case 'search': {
          const scan=clamp(1.7*s,-1,1);
          tilt=.065*scan;break;
        }
        case 'process':tilt=.018*Math.sin(p*TAU*3);break;
        case 'idea':tilt=.035*hop;break;
        case 'hello':tilt=.045*Math.sin(p*TAU*3)*hop;dy=-3*hop;break;
        case 'celebrate':dy=-15*Math.abs(Math.sin(p*TAU));tilt=.06*s;break;
        case 'surprise':dy=-12*hop;sx=1-.04*hop;break;
        case 'oops':dx=3*Math.sin(p*TAU*4)*(1-p);tilt=-.06*hop;break;
        case 'grab':case 'drag':
          tilt=swing+.035*Math.sin(now/180);break;
        case 'snack':tilt=-.028*hop+.012*Math.sin(p*TAU*5)*hop;break;
        case 'flower':tilt=-.045*hop;break;
        case 'photo':tilt=.045*Math.exp(-130*(p-.51)**2);break;
        case 'strum':tilt=.024*s;break;
        case 'plane':tilt=.10*Math.exp(-55*(p-.41)**2)-.04*Math.exp(-80*(p-.25)**2);break;
        case 'bubble':tilt=.016*s;break;
        case 'rain':tilt=-.022*hop;break;
        case 'shrug':dy=-2*hop;tilt=.043*hop;break;
        case 'sneeze':tilt=(p<.48?-.06*hop:.15*Math.exp(-18*(p-.54)**2))*hop;
          dy=-4*Math.exp(-130*(p-.53)**2)*hop;break;
        case 'letter':tilt=.035*hop;break;
        case 'laugh':tilt=.022*Math.sin(p*TAU*4)*hop;break;
        case 'blush':tilt=-.025*hop;break;
        case 'highFive':tilt=-.09*Math.exp(-25*(p-.39)**2)*hop;break;
        case 'drop':tilt=.085*Math.sin(p*TAU*2)*Math.pow(1-p,2);break;
        case 'settle':tilt=.04*Math.sin(p*TAU*2)*Math.pow(1-p,2);break;
      }
      const dangling=pose==='carry'&&!reduced.matches;
      const flutter=dangling?1.6*Math.sin(now/115)+swing*13:0;
      const detail=detailFor(id,p,now);
      drawSprite(pose,dx,dy,tilt,sx,sy,flutter,detail);
      const rise=Math.round(13*p);
      const thoughtAlpha=bridge?.thinking?ease(clamp((now-bridge.start)/bridge.duration,0,1)):1;
      switch(id) {
        case 'vibe':
          mark('note',111,56-rise,palette.blue,2,1-p*.7);
          mark('note',24,81-rise,palette.pink,2,.55+p*.4);break;
        case 'hum':
          mark('note',94+Math.round(p*15),98-rise,palette.peach,1,hop);
          break;
        case 'sleep':mark('z',112,77-rise,palette.blue,2,1-p*.65);mark('z',124,62-rise,palette.blue,2,p);break;
        case 'yawn':
          if(p>.24&&p<.66) mark('spark',97+Math.round(p*8),99-Math.round(p*6),palette.peach,1,hop);
          break;
        case 'game':if(detail?.press) mark('spark',95,122,palette.gold,1,.85);break;
        case 'tea':
          mark('steam',75,111-rise,palette.blue,1,1-p*.75);
          mark('steam',69,114-rise,palette.peach,1,hop);
          break;
        case 'daydream':mark('heart',108,55-rise,palette.pink,2,hop);break;
        case 'stargaze':mark('star',107,39,palette.gold,2,.5+hop*.5);mark('spark',34,48,palette.pink,2,1-p*.75);break;
        case 'ponder':mark('question',110,44-rise,palette.blue,2,thoughtAlpha*(.65+hop*.35));break;
        case 'idea':
          mark('bulb',108,53-rise,palette.blue,2,.9*thoughtAlpha);
          mark('spark',124,50-rise,palette.peach,1,thoughtAlpha*(.3+.7*hop));
          break;
        case 'hello':mark('spark',110,69,palette.gold,2,hop);break;
        case 'celebrate':
          mark('star',27,65-rise,palette.gold,2,hop);mark('heart',111,56-rise,palette.pink,2,hop);break;
        case 'surprise':case 'grab':mark('bang',112,43-rise,palette.pink,2,hop);break;
        case 'oops':mark('question',111,56,palette.pink,2,hop);break;
        case 'drag':
          if(Math.abs(swing)>.06) mark('spark',swing>0?27:115,117,palette.blue,2,Math.abs(swing)*4);
          break;
        case 'snack':
          if(p>=.25&&p<.47) {
            const q=(p-.25)/.22;
            mark('dot',66-Math.round(5*q),104+Math.round(9*q),palette.gold,1,1-q);
            mark('dot',72+Math.round(7*q),106+Math.round(11*q),palette.peach,1,1-q);
          }
          break;
        case 'flower':
          if(p>.26&&p<.66) mark('petal',65+Math.round(p*7),99-rise,palette.pink,1,hop);
          break;
        case 'photo':
          if(detail?.camera) {
            mark('star',68,101,palette.cream,2,detail.camera);
            mark('spark',83,93,palette.gold,1,detail.camera);
          }
          break;
        case 'strum': {
          const beat=(p*4)%1;
          if(beat>.22) mark('note',103+Math.round(beat*10),115-Math.round(beat*21),palette.pink,1,1-beat);
          break;
        }
        case 'plane':
          if(p>=.38&&p<.89) {
            const q=(p-.38)/.51;
            const x=26-Math.round(45*q),y=102-Math.round(Math.sin(q*Math.PI*.73)*39+q*22);
            for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])
              mark('planeBody',x+dx,y+dy,palette.ink,2,1);
            mark('planeBody',x,y,palette.cream,2,1);
            mark('planeFold',x,y,palette.peach,2,1);
            if(q>.09) mark('dot',x+17,y+5,palette.blue,1,.38);
          }
          break;
        case 'bubble':
          if(p>.18&&p<.80) {
            const q=(p-.18)/.62;
            mark('bubble',75+Math.round(q*28),100-Math.round(q*42),palette.blue,q>.30?2:1,1-q*.45);
          }
          if(p>=.80&&p<.98) {
            const spread=Math.round((p-.80)*44);
            for(const [dx,dy] of [[-1,0],[1,-1],[0,1]]) mark('spark',108+dx*spread,60+dy*spread,palette.peach,1,1-spread/9);
          }
          break;
        case 'rain':
          for(let i=0;i<7;i++) {
            const q=(p*2+i*.37)%1;
            const x=i<4?13+i*7:109+(i-4)*8;
            if(q<.89) mark('droplet',x,24+Math.round(q*126),palette.blue,1,.35+q*.4);
            else {
              const ripple=Math.round((q-.89)*35);
              ctx.globalAlpha=Math.max(0,1-ripple*.24);
              ctx.fillStyle=palette.blue;ctx.fillRect(x-ripple,142,2+ripple*2,1);
              ctx.globalAlpha=1;
            }
          }
          break;
        case 'toeTap':
          if(p>.25&&p<.38||p>.68&&p<.80) mark('spark',56,149,palette.peach,1,.65);
          break;
        case 'shrug':if(p>.27&&p<.64) mark('question',110,72,palette.blue,1,hop);break;
        case 'sneeze':
          if(p>.48&&p<.70) for(let i=0;i<3;i++)
            mark('spark',33-Math.round((p-.48)*60)-i*4,98+i*7,palette.peach,1,1-p);
          break;
        case 'letter':
          if(p>.24&&p<.77) mark('heart',29-Math.round(p*12),102-Math.round(p*34),palette.pink,2,hop);
          break;
        case 'laugh':
          if(p>.17&&p<.84) {
            mark('spark',32,94-rise,palette.gold,1,hop);
            mark('spark',107,100-rise,palette.peach,1,hop);
          }
          break;
        case 'blush':if(p>.30&&p<.78) mark('heart',109,82-rise,palette.pink,1,hop);break;
        case 'highFive':
          if(p>.30&&p<.52) mark('star',28,89-rise,palette.gold,2,1-Math.abs(p-.38)*5);
          break;
        case 'drop':for(const px of [34,43,102,111])mark('dot',px,149-(px%3)*3,palette.peach,1,hop);break;
        case 'settle':mark('check',107,67,palette.blue,2,hop);break;
      }
    }
    function tick(raw) {
      const now=clock(raw);
      if(dead) return;
      if(!pointer && now>=next) {
        if(following) {
          const id=following;
          scheduleActivity(id,{
            automatic:activity.automatic,
            linked:id==='page'||id==='sip',
            returning:id==='tea'&&activity.automatic,
          });
        }
        else if(current.id==='drop') {select('settle');next=started+current.duration;}
        else if(current.id==='settle'&&afterDrag) {
          const previous=afterDrag;
          afterDrag=null;
          scheduleActivity(previous.id,previous);
        }
        else if(groups.reactions.includes(current.id)||activity.automatic) resume();
        else next=Infinity;
      }
      if(pointer&&current.id==='grab'&&now-started>=current.duration) select('drag');
      const dt=lastTick===null?0:Math.min(.035,(raw-lastTick)/1000); // carry physics stay real-time
      lastTick=raw;
      carry*=Math.exp(-8*dt);
      swingVelocity=(swingVelocity+(carry-swing)*54*dt)*Math.exp(-7*dt);
      swing=clamp(swing+swingVelocity*dt,-.22,.22);
      const interval=bridge||pointer||current.id==='drop'||current.id==='wake'?1000/40:1000/30;
      if(dirty||(!paused&&!reduced.matches&&raw-last>=interval)) {draw(now);last=raw;dirty=false;}
      frame=requestAnimationFrame(tick);
    }
    if(interactive) canvas.addEventListener('pointerdown',event=>{
      if(!event.isPrimary||event.button!==0||pointer) return;
      event.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
      pointer={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,x,y,lastX:event.clientX};
      if(!groups.reactions.includes(current.id)) afterDrag={id:current.id,...activity};
      following=null;
      moved=false;carry=0;swing=0;swingVelocity=0;
      canvas.style.cursor='grabbing';select('grab');
    },{signal});
    if(interactive) canvas.addEventListener('pointermove',event=>{
      if(pointer?.id!==event.pointerId) return;
      const dx=event.clientX-pointer.clientX,dy=event.clientY-pointer.clientY;
      if(!moved&&Math.hypot(dx,dy)<4) return;
      if(!moved) {moved=true;select('drag');}
      carry=clamp((event.clientX-pointer.lastX)*.025,-.25,.25);
      pointer.lastX=event.clientX;position(pointer.x+dx,pointer.y+dy);
    },{signal});
    function releasePointer(event) {
      if(pointer?.id!==event.pointerId) return;
      pointer=null;canvas.style.cursor='grab';
      const tap=!moved&&event.type==='pointerup'&&current.id==='grab'&&clock()-started<175*rate;
      if(tap) afterDrag=null;
      select(tap?'hello':event.type==='pointerup'?'drop':'settle');
      next=started+current.duration;
    }
    if(interactive) for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,releasePointer,{signal});
    if(interactive) canvas.addEventListener('keydown',event=>{
      const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if(direction) {event.preventDefault();position(x+direction[0]*12,y+direction[1]*12);}
      if(event.key==='Enter'||event.key===' ') {event.preventDefault();play('hello');}
    },{signal});
    const layout=new ResizeObserver(()=>position(x,y));
    layout.observe(host);
    position((host.clientWidth-W)/2,(host.clientHeight-H)/2);
    canvas.hidden=true;canvas.style.display='none';
    const ready=loadArt().then(result=>{
      if(dead)return;
      art=result;canvas.hidden=false;canvas.style.display='block';
      if(auto&&next===Infinity&&current.id==='breathe') {resting=!!rest;next=clock()+restFor();}
      frame=requestAnimationFrame(tick);
    });
    return {ready,play,setMode,doze,wake,grab,carry:carryBy,release,pause,element:canvas,
      get asleep(){return napping;},get current(){return current.id;},destroy(){
      dead=true;events.abort();layout.disconnect();cancelAnimationFrame(frame);canvas.remove();host.style.position=previousPosition;
    }};
  }
  window.FayeCompanion=Object.freeze({mount,actions,groups});
})();
