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
    ['plane','Paper plane','plane',4700],
    ['bubble','Blowing bubbles','hum',2400],
    ['rain','Watching the rain','stand',3200],
    ['toeTap','Tapping a foot','stand',1050],
    ['walk','Walking','stand',4000],
    ['ramen','Eating ramen','book',3200], ['rice','Eating rice','stand',3000],
    ['onigiri','Eating onigiri','stand',2800], ['sticks','Biscuit sticks','stand',2800],
    ['taiyaki','Eating taiyaki','stand',2800], ['iceCream','Ice cream','stand',2800],
    ['cola','Drinking cola','stand',3000], ['boba','Bubble tea','stand',3200],
    ['strawberryMilk','Strawberry milk','stand',2600], ['ramune','Drinking ramune','stand',2600],
    ['dance','Dancing','music',2400], ['chill','Chill music','music',2800],
    ['idleFun','Bored antics','stand',3200],
  ];
  const thinking = [
    ['ponder','Pondering','think',2200],
    ['search','Searching','search',2450],
    ['process','Working it out','write',2450],
    ['idea','Lightbulb moment','idea',2100],
    ['thinkAlt','Thinking another way','think',2800],
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
    ['newOrder','New order','stand',1800], ['orderShipped','Parcel shipped','stand',1800],
    ['slipChecked','Slip checked','stand',1800], ['countMoney','Counting sales','stand',2400],
    ['sad','Feeling sad','stand',750], ['dizzy','Feeling dizzy','stand',750],
    ['annoyed','Annoyed pout','stand',750], ['relieved','Feeling relieved','stand',750],
    ['poke','Poked','stand',1000], ['tickle','Ticklish giggle','stand',1200],
    ['hideFace','Hiding his face','stand',1000], ['peace','Peace sign','stand',1200],
  ];
  const actions = Object.freeze(Object.fromEntries([...idle,...thinking,...reactions].map(
    ([id,label,pose,duration])=>[id,Object.freeze({id,label,pose,duration})])));
  const groups = Object.freeze({
    idle:Object.freeze(idle.map(([id])=>id)), thinking:Object.freeze(thinking.map(([id])=>id)),
    reactions:Object.freeze(reactions.map(([id])=>id)),
  });
  const idleCycle=groups.idle.filter(id=>id!=='page'&&id!=='sleep'&&id!=='sip'&&id!=='wake');
  const authored = {
    'idle-breath': ['inhale','exhale','weightShift','tapFoot'],
    transition: ['anticipate','hopUp','land','standSettle'],
    look: ['lookLeft','lookRight','lookUp','lookNod'],
    stargaze: ['starUpLeft','starUp','starUpRight','starSigh'],
    wave: ['waveLift','waveLeft','waveRight','palmHighFive'],
    cheer: ['cheerJump','cheerLand','laughBack','laughForward'],
    feelings: ['feelSurprise','feelOops','feelBlush','feelNo'],
    sneeze: ['sneezeIn','sneezeHold','sneezeRelease','sneezeAfter'],
    carry: ['carryGrab','carryLeft','carryRight','carryLand'],
    letter: ['letterHide','letterOffer','shrugStart','shrugFull'],
    think: ['ponderLeft','ponderRight','ideaLift','ideaPoint'],
    search: ['searchLeft','searchRight','searchFront','searchFound'],
    write: ['writeFast','writeCheek','writeHead','writeProud'],
    sleep: ['yawnStart','yawnFull','sleepIn','sleepOut'],
    wake: ['awake','eyeRub','wakeStretch','wakeRise'],
    tea: ['teaBlow','teaDrink','teaSigh','teaPeek'],
    music: ['vibeLeft','vibeRight','humOpen','humSmile'],
    game: ['gameFocus','gameLeft','gameRight','gameWin'],
    'daydream-stretch': ['dreamClasp','dreamLean','stretchUp','stretchSide'],
    outdoors: ['rainUmbrella','rainCatch','bubbleBlow','bubbleWatch'],
    'snack-photo': ['cookieChew','cookieLick','photoShoot','photoCheck'],
    extras: ['bagTwist','bagSwing','flowerSniff','ukuleleSing'],
    reading: ['bookRead','bookPinch','bookLift','bookSweep'],
    'paper-plane': ['planeHold','planeRelease','planeWatch','planeLower'],
    'satchel-motion': ['bagReach','bagOpen','bagLift','bagClose'],
    'bag-mug-cookie': ['bagMugHalf','bagMugChest','bagCookieHalf','bagCookieChest'],
    'bag-camera-flower': ['bagCameraHalf','bagCameraChest','bagFlowerHalf','bagFlowerChest'],
    'bag-ukulele-letter': ['bagUkuleleHalf','bagUkuleleChest','bagLetterHalf','bagLetterChest'],
    'bag-notebook-plane': ['bagNotebookHalf','bagNotebookChest','bagPlaneHalf','bagPlaneChest'],
    'bag-console-book': ['bagConsoleHalf','bagConsoleSit','bagBookHalf','bagBookSit'],
    'bag-empty': ['bagLook','bagFlap','bagRise','bagPat'],
    'hobby-motion': ['flowerLow','flowerNear','strumReady','strumDown'],
    talk: ['talkClosed','talkHalf','talkWide','talkBlink'],
    walk: ['walkContactLeft','walkPassLeft','walkContactRight','walkPassRight'],
    'shop-order': ['orderPhone','orderParcel','orderTape','orderThumb'],
    'shop-money': ['slipHappy','slipInspect','moneyFan','moneyHug'],
    moods: ['moodSad','moodDizzy','moodAnnoyed','moodRelieved'],
    poke: ['pokeFlinch','pokeGiggle','pokeHide','pokePeace'],
    'music-2': ['vibeCenter','vibeDown','humLeft','humRight'],
    'think-2': ['ponderUp','ponderTap','ponderCross','ponderHmm'],
    'look-2': ['lookForward','peekLeftUp','peekRightUp','lookWonder'],
    'eat-onigiri': ['onigiriAdmire','onigiriBite','onigiriChew','onigiriFilling'],
    'drink-cola': ['colaOpen','colaDrink','colaAhh','colaBurp'],
    'eat-ramen': ['ramenLook','ramenSlurp','ramenChew','ramenSoup'],
    'eat-rice': ['riceProud','riceBite','riceChew','riceEmpty'],
    'eat-sticks': ['sticksPull','sticksCool','sticksCrunch','sticksOffer'],
    'drink-boba': ['bobaAdmire','bobaSip','bobaChew','bobaShake'],
    'vibe-2': ['danceLeft','danceRight','danceGuitar','dancePoint'],
    'think-3': ['thinkCount','thinkTemple','thinkPencil','thinkSkeptical'],
    'drink-milk': ['milkSip','milkSqueeze','ramuneOpen','ramuneDrink'],
    'vibe-3': ['chillLeft','chillRight','chillSnap','chillSing'],
    'idle-fun': ['funGlasses','funBubble','funPop','funBalance'],
    'eat-sweets': ['taiyakiAdmire','taiyakiBite','iceLick','iceDrip'],
    'bridge-wake': ['bridgeWakeFrom','bridgeWakeOne','bridgeWakeTwo','bridgeWakeTo'],
    'bridge-vibe': ['bridgeVibeFrom','bridgeVibeOne','bridgeVibeTwo','bridgeVibeTo'],
    'bridge-hum': ['bridgeHumFrom','bridgeHumOne','bridgeHumTwo','bridgeHumTo'],
    'bridge-ponder': ['bridgePonderFrom','bridgePonderOne','bridgePonderTwo','bridgePonderTo'],
  };
  const clips = {
    breathe:['exhale','exhale','inhale','inhale'], vibe:['vibeLeft','vibeCenter','vibeRight','vibeDown'],
    sleep:['sleepIn','sleepOut','sleepIn','sleepOut'], game:['gameFocus','gameLeft','gameRight','gameWin'],
    page:['bookRead','bookPinch','bookLift','bookSweep'],
    tea:['teaBlow','teaPeek','teaBlow','teaSigh','teaPeek'], daydream:['dreamClasp','dreamLean','dreamClasp','dreamLean'],
    stretch:['anticipate','stretchUp','stretchSide','stretchUp'], yawn:['yawnStart','yawnFull','yawnStart','yawnFull','talkClosed'],
    peek:['lookForward','lookLeft','peekLeftUp','lookForward','lookRight','peekRightUp'],
    hum:['humOpen','humLeft','humSmile','humRight'],
    sway:['weightShift','exhale','weightShift','inhale'], fidget:['bagTwist','bagSwing','bagTwist','bagSwing'],
    stargaze:['starUpLeft','starUp','lookWonder','starUpRight','starSigh'],
    sip:['teaBlow','teaDrink','teaSigh','teaDrink','teaPeek'],
    snack:['cookieChew','cookieLick','cookieChew','cookieLick'],
    flower:['flowerLow','flowerNear','flowerLow','flowerNear','flowerLow','flowerNear'],
    photo:['photoShoot','photoCheck','photoShoot','photoCheck'],
    strum:['strumReady','strumDown','strumReady','strumDown'],
    bubble:['bubbleBlow','bubbleWatch','bubbleBlow','bubbleWatch'],
    rain:['rainUmbrella','rainCatch','rainUmbrella','rainCatch','rainUmbrella','rainCatch'],
    toeTap:['exhale','tapFoot','exhale','tapFoot'],
    ponder:['ponderLeft','ponderUp','ponderRight','ponderTap','ponderCross','ponderHmm'],
    search:['searchLeft','searchRight','searchFront','searchFound'],
    process:['writeFast','writeCheek','writeHead','writeProud'],
    idea:['ideaLift','ideaPoint','ideaLift','ideaPoint','ideaPoint','ideaLift'],
    hello:['waveLift','waveLeft','waveRight','waveLeft','waveRight','waveLift'],
    celebrate:['cheerJump','cheerLand','cheerJump','cheerLand'], surprise:['anticipate','feelSurprise','feelSurprise','standSettle'],
    oops:['feelOops','feelOops','talkClosed'], grab:['carryGrab'], drag:['carryLeft','carryRight'],
    drop:['carryLand','land','standSettle'], settle:['standSettle','talkClosed'], shrug:['shrugStart','shrugFull','shrugFull','talkClosed'],
    sneeze:['sneezeIn','sneezeHold','sneezeRelease','sneezeAfter'],
    letter:['letterHide','letterOffer','letterOffer','letterHide','letterOffer'], laugh:['laughBack','laughForward','laughBack','laughForward'],
    yes:['talkClosed','lookNod','talkClosed','lookNod','talkClosed'], no:['talkClosed','feelNo','talkClosed','feelNo'],
    blush:['talkClosed','feelBlush','feelBlush','talkClosed','standSettle'],
    highFive:['waveLift','palmHighFive','palmHighFive','waveLift'],
    walk:['walkContactLeft','walkPassLeft','walkContactRight','walkPassRight'],
    ramen:['ramenLook','ramenSlurp','ramenChew','ramenSoup'],
    rice:['riceProud','riceBite','riceChew','riceEmpty'],
    onigiri:['onigiriAdmire','onigiriBite','onigiriChew','onigiriFilling'],
    sticks:['sticksPull','sticksCool','sticksCrunch','sticksOffer'],
    taiyaki:['taiyakiAdmire','taiyakiBite','taiyakiAdmire','taiyakiBite'],
    iceCream:['iceLick','iceDrip','iceLick','iceDrip'],
    cola:['colaOpen','colaDrink','colaAhh','colaBurp'],
    boba:['bobaAdmire','bobaSip','bobaChew','bobaShake'],
    strawberryMilk:['milkSip','milkSqueeze','milkSip','milkSqueeze'],
    ramune:['ramuneOpen','ramuneDrink','ramuneOpen','ramuneDrink'],
    dance:['danceLeft','danceRight','danceGuitar','dancePoint'],
    chill:['chillLeft','chillRight','chillSnap','chillSing'],
    idleFun:['funGlasses','funBubble','funPop','funBalance'],
    thinkAlt:['thinkCount','thinkTemple','thinkPencil','thinkSkeptical'],
    newOrder:['orderPhone','orderParcel','orderPhone','orderParcel'],
    orderShipped:['orderTape','orderParcel','orderThumb','orderParcel'],
    slipChecked:['slipInspect','slipHappy','slipInspect','slipHappy'],
    countMoney:['moneyFan','moneyHug','moneyFan','moneyHug'],
    sad:['moodSad'], dizzy:['moodDizzy'], annoyed:['moodAnnoyed'], relieved:['moodRelieved'],
    poke:['pokeFlinch','pokePeace'], tickle:['pokeGiggle','pokeFlinch','pokeGiggle'],
    hideFace:['pokeHide','pokeFlinch','pokeHide'], peace:['pokePeace','pokeGiggle','pokePeace'],
  };
  const props={
    game:'console',read:'book',page:'book',tea:'mug',sip:'mug',snack:'cookie',flower:'flower',
    photo:'camera',strum:'ukulele',plane:'paper',process:'notebook',letter:'letter',
    ramen:'ramen',rice:'rice',onigiri:'onigiri',sticks:'sticks',taiyaki:'taiyaki',iceCream:'iceCream',
    cola:'cola',boba:'boba',strawberryMilk:'milk',ramune:'ramune',
  };
  const propPixels={
    paper:[['00001111','00111110','11111100','00111000','00010000'],'#fff1d7'],
  };
  const bagPoses={
    mug:['bagMugHalf','bagMugChest'], cookie:['bagCookieHalf','bagCookieChest'],
    camera:['bagCameraHalf','bagCameraChest'], flower:['bagFlowerHalf','bagFlowerChest'],
    ukulele:['bagUkuleleHalf','bagUkuleleChest'], letter:['bagLetterHalf','bagLetterChest'],
    notebook:['bagNotebookHalf','bagNotebookChest'], paper:['bagPlaneHalf','bagPlaneChest'],
    console:['bagConsoleHalf','bagConsoleSit'], book:['bagBookHalf','bagBookSit'],
    ramen:['bagRamenHalf','bagRamenSit'],rice:['bagRiceHalf','riceProud'],
    onigiri:['bagOnigiriHalf','onigiriAdmire'],sticks:['bagSticksHalf','sticksPull'],
    taiyaki:['bagTaiyakiHalf','taiyakiAdmire'],iceCream:['bagIceHalf','iceLick'],
    cola:['bagColaHalf','colaOpen'],boba:['bagBobaHalf','bobaAdmire'],
    milk:['bagMilkHalf','milkSip'],ramune:['bagRamuneHalf','ramuneOpen'],
  };
  // Reuse the approved prop pixels at their original scale for the new food bag handoffs.
  const foodInBag={
    bagRamenHalf:{pose:'ramenLook',crop:[30,52,17,12]},
    bagRamenSit:{pose:'ramenLook',crop:[30,52,17,12],crouch:true},
    bagRiceHalf:{pose:'riceProud',crop:[35,50,13,9]},
    bagOnigiriHalf:{pose:'onigiriAdmire',crop:[31,46,11,10]},
    bagSticksHalf:{pose:'sticksPull',crop:[39,48,10,13]},
    bagTaiyakiHalf:{pose:'taiyakiAdmire',crop:[28,46,18,11]},
    bagIceHalf:{pose:'iceLick',crop:[29,46,11,15]},
    bagColaHalf:{pose:'colaOpen',crop:[43,47,9,12]},
    bagBobaHalf:{pose:'bobaAdmire',crop:[30,45,15,16]},
    bagMilkHalf:{pose:'milkSip',crop:[31,45,13,15]},
    bagRamuneHalf:{pose:'ramuneOpen',crop:[32,49,10,15]},
  };
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
    petal:['010','111','010'],
    steam:['010','100','010','001','010'],
    check:['00001','00010','10100','01000'],
  };
  const palette={ink:'#43251d',peach:'#ffa87d',pink:'#ed7c86',blue:'#388aa9',gold:'#ffd79a',cream:'#fff1d7'};
  let imagePromise;
  // Each sheet loads on its own with a time limit and one retry. A sheet that still fails is
  // skipped (its poses fall back to the resting drawing), so one slow or broken file can never
  // keep Faye hidden. Only the resting/talking sheets are required.
  const required=['idle-breath','talk'];
  function loadSheet(file,attempt=0) {
    return new Promise((resolve,reject)=>{
      const img=new Image();
      const timer=setTimeout(()=>{img.src='';reject(new Error('slow '+file));},15000);
      img.onload=()=>{clearTimeout(timer);resolve(img);};
      img.onerror=()=>{clearTimeout(timer);reject(new Error('load '+file));};
      img.src=new URL('assets/'+file+'.png'+version+(attempt?(version?'&':'?')+'retry='+attempt:''),base);
    }).then(img=>img.decode?img.decode().then(()=>img,()=>img):img)
      .catch(error=>attempt<1?loadSheet(file,attempt+1):Promise.reject(error));
  }
  function loadArt() {
    if (imagePromise) return imagePromise;
    imagePromise = Promise.all(Object.entries(authored).map(([file,poses])=>loadSheet(file).then(
      img=>poses.map((pose,i)=>[pose,{img,left:i%2*288,top:Math.floor(i/2)*328}]),
      error=>{if(required.includes(file)) throw error; console.warn('Faye:',error.message); return [];},
    ))).then(items=>{
      const result=Object.fromEntries(items.flat());
      for(const [pose,prop] of Object.entries(foodInBag)) {
        const body=result[prop.crouch?'bagRise':'bagOpen'];
        if(body&&result[prop.pose]) result[pose]={...body,prop};
      }
      return result;
    }).catch(error=>{imagePromise=undefined;throw error});
    return imagePromise;
  }
  const W=144,H=164, FLOOR=150, TAU=2*Math.PI;
  const seated = new Set(['sleep','game','book','awake','eyeRub','wakeStretch']);
  const grounded = new Set(['stand','tea','music','think','wave','yawn','hum','fidget','search','write','idea','snack','flower','photo','strum','plane','shrug','sneeze','letter']);
  const presses=[[.12,.17,-1],[.22,.27,1],[.32,.36,1],[.52,.58,-1],[.65,.70,1],[.80,.86,-1]];
  const transitionMs=800,bagFrameMs=150,sleepMs=6500;
  const transitionFrames=['anticipate','hopUp','land','standSettle'];
  const wakeFrames=[
    [0,'sleepOut'],[.12,'awake'],[.25,'eyeRub'],[.47,'awake'],
    [.54,'wakeStretch'],[.70,'wakeRise'],[.78,'bridgeWakeOne'],[.86,'bridgeWakeTwo'],[.94,'standSettle'],[.98,'talkClosed'],
  ];
  const readFrames=[
    [0,'bookRead'],[780,'bookPinch'],[1310,'bookLift'],
    [1800,'bookSweep'],[2330,'bookRead'],[3050,'bookPinch'],
  ];
  const planeFrames=[
    [0,'planeHold'],[.16,'planeRelease'],[.32,'planeWatch'],[.48,'planeLower'],
    [.64,'bagReach'],[.73,'bagOpen'],[.81,'bagPlaneHalf'],[.94,'bagPlaneChest'],
  ];
  const neutralTalk=new Set(['inhale','exhale','weightShift','tapFoot','talkClosed','standSettle']);
  const mouthFrames=['talkClosed','talkHalf','talkWide','talkHalf'];
  const actionBridges={
    vibe:['bridgeVibeOne','bridgeVibeTwo'],
    hum:['bridgeHumOne','bridgeHumTwo'],
    ponder:['bridgePonderOne','bridgePonderTwo'],
  };
  // Coordinates on the sheets' 72×82 logical pixel grid, measured over each visible iris.
  const eyelids={
    // inhale / exhale / weightShift / tapFoot are built from talkClosed (scripts note in ART-PROMPTS.md)
    inhale:[[29,37,4,4],[40,37,4,4]],
    exhale:[[29,38,4,4],[40,38,4,4]],
    weightShift:[[28,38,4,4],[39,38,4,4]],
    tapFoot:[[29,38,4,4],[40,38,4,4]],
    lookLeft:[[26,36,3,4],[35,36,3,4]],
    lookRight:[[36,36,3,4],[45,35,3,4]],
    talkClosed:[[29,38,4,4],[40,38,4,4]],
  };

  function transitionPose(transition,now) {
    const progress=(now-transition.start)/transitionMs;
    const index=Math.min(3,Math.max(0,Math.floor(progress*4)));
    return transition.rising&&index===0?'bagRise':transitionFrames[index];
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
    // Sharp at any size: the art is a 72×82 pixel grid, so the canvas gets a whole
    // number of SCREEN pixels per art pixel (k) and is drawn at the screen's own
    // resolution. The drawing code keeps working in the 144×164 space (scale k/2).
    let k=2,scale=1;
    function fit() {
      const dpr=window.devicePixelRatio||1;
      const want=interactive?W:(host.clientWidth||W);
      // Screen pixels per art pixel at the size the page asks for. A whole number keeps every
      // art pixel even; but if rounding would change his size by more than 8% (e.g. Windows at
      // 125%: 2.5 -> 3 makes him 20% bigger), keep his size and accept slightly uneven pixels.
      const exact=want*dpr/72;
      k=Math.max(1,Math.round(exact));
      if(Math.abs(k-exact)/exact>.08) k=exact;
      const cw=Math.round(72*k),ch=Math.round(82*k);
      scale=cw/144;
      if(canvas.width!==cw||canvas.height!==ch) {canvas.width=cw;canvas.height=ch;ctx.imageSmoothingEnabled=false;}
      const cssW=cw/dpr,cssH=ch/dpr;
      canvas.style.width=cssW+'px';canvas.style.height=cssH+'px';
      if(!interactive) { // centred on the stage, feet on its floor
        canvas.style.left=Math.round((host.clientWidth-cssW)/2*dpr)/dpr+'px';
        canvas.style.top=Math.round((host.clientHeight-cssH)*dpr)/dpr+'px';
      }
      dirty=true;
    }
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const events=new AbortController(),signal=events.signal;
    let art,dead=false,frame,last=0,dirty=true,mode='idle', current=actions.breathe;
    let started=clock(), next=Infinity, x=0,y=0, moved=false, pointer=null, carry=0;
    let idleIndex=1,thinkIndex=0,transition=null,bridge=null,visual=null,afterDrag=null,bagIntro=null;
    let swing=0,swingVelocity=0,lastTick=null;
    let walkDirection=-1;
    let activity={automatic:auto,linked:false,returning:false},following=null;
    let napping=false,paused=false,resting=false,talkStart=0,talkEnd=0;
    const blinkGap=()=>3000+Math.random()*3000;
    let nextBlink=t0+blinkGap(),blinkUntil=0;
    const restFor=()=>rest?rest[0]+Math.random()*Math.max(0,rest[1]-rest[0]):7600;
    const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
    function position(px,py) {
      x=clamp(px,0,Math.max(0,host.clientWidth-W));y=clamp(py,0,Math.max(0,host.clientHeight-H));
      if(interactive) canvas.style.transform='translate('+Math.round(x)+'px,'+Math.round(y)+'px)';
      dirty=true;
    }
    function startBridge(from,to,now,duration,thinking=false) {
      if(!from||reduced.matches) return null;
      if(from.pose===to) return null;
      return {from,to,start:now,duration,thinking};
    }
    function select(id) {
      const now=clock();
      if(bagIntro&&now>=started) bagIntro=null;
      const yawnFinished=current.id==='yawn'&&now-started>=current.duration*.86;
      const wakeFinished=current.id==='wake'&&now-started>=current.duration*.86;
      const shown=visual?.pose??'inhale';
      const from=bagIntro?(bagIntro.seated?'book':'stand'):yawnFinished||wakeFinished?'stand':current.pose;
      const to=id==='wake'?'sleep':actions[id].pose;
      const firstPose=id==='wake'?'sleepOut':id==='plane'?'planeHold':id==='read'?'bookRead':clips[id][0];
      const changingCarry=(to==='carry')!==(current.pose==='carry');
      const changingThought=groups.thinking.includes(id)&&grounded.has(from)&&from!==to;
      if(changingCarry) bridge=startBridge(visual,firstPose,now,to==='carry'?245:325);
      else if(changingThought) bridge=startBridge(visual,firstPose,now,430,true);
      else if(bridge?.to!==firstPose) bridge=null;
      const sitDown=(grounded.has(from)||from==='crouch')&&seated.has(to);
      const standUp=(seated.has(from)||from==='crouch')&&grounded.has(to);
      const interruptible=!pointer&&!['grab','drag','drop','hello','celebrate','settle'].includes(id);
      const planeInHand=['planeHold',...bagPoses.paper].includes(shown);
      const outgoing=bagIntro?bagIntro.held:current.id==='plane'&&!planeInHand?null:props[current.id];
      const incoming=props[id];
      const switchProp=interruptible&&!reduced.matches&&id!==current.id&&outgoing!==incoming&&(outgoing||incoming);
      const continueBag=interruptible&&!reduced.matches&&bagIntro&&incoming&&bagIntro.incoming===incoming;
      if(!continueBag) bagIntro=switchProp?buildBagIntro(from,to,outgoing,incoming,now,shown):null;
      if(bagIntro) bridge=null;
      transition=!bagIntro&&interruptible&&!reduced.matches&&(sitDown||standUp)?{start:now,rising:standUp}:null;
      const middle=actionBridges[id];
      if(!bagIntro&&!transition&&!reduced.matches&&neutralTalk.has(shown)&&middle) {
        bridge={from:visual,to:firstPose,start:now,duration:720,poses:[shown,...middle,firstPose],thinking:false};
      }
      const preludeMs=bagIntro?bagIntro.start+bagIntro.duration-now:transition?transitionMs:bridge?.poses?bridge.duration:0;
      current=actions[id];started=now+preludeMs;dirty=true;
      host.dispatchEvent(new CustomEvent('faye:state',{detail:{mode,id,label:current.label,preludeMs}}));
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
      const oneCycle=following!==null||id==='wake'||(id==='plane'&&automatic)||(linked&&id==='page')||returning||groups.reactions.includes(id);
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
      if(pointer||bagIntro&&current.id===id&&clock()<started) return;
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
    function pause(value) {paused=!!value;if(paused) talkEnd=0;dirty=true;}
    function talk(ms=1000) {
      talkStart=clock();
      talkEnd=ms>0&&!paused&&!reduced.matches?talkStart+Math.min(ms,3000):0;
      dirty=true;
    }
    function mark(name,x,y,color,size=2,alpha=1) {
      ctx.globalAlpha=clamp(alpha,0,1);
      ctx.fillStyle=color;
      glyphs[name].forEach((row,j)=>[...row].forEach((p,i)=>{
        if(p==='1')ctx.fillRect(Math.round(x)+i*size,Math.round(y)+j*size,size,size);
      }));
      ctx.globalAlpha=1;
    }
    function drawFrame(frame) {
      const animate=!reduced.matches&&!paused;
      const beingCarried=current.id==='grab'||current.id==='drag';
      const speaking=drawTime<talkEnd&&animate&&!beingCarried&&!pointer;
      const beat=Math.floor((drawTime-talkStart)/105);
      const neutral=neutralTalk.has(frame.pose);
      const pose=speaking&&neutral?mouthFrames[beat%mouthFrames.length]:frame.pose;
      const sprite=art[pose]||art.exhale||art.talkClosed;
      if(!sprite) return;
      const {img,left,top}=sprite;
      const breathing=animate&&!beingCarried&&frame.pose!=='cheerJump';
      const bob=breathing&&!neutral?(speaking?-(beat%2):Math.cos((drawTime-t0)*TAU/2400)<0?-1:0):0;
      ctx.save();
      ctx.translate(Math.round(frame.x),Math.round(frame.y)+bob);
      ctx.rotate(frame.tilt);
      if(current.id==='walk'&&drawTime>=started&&!bagIntro&&!transition&&walkDirection>0) ctx.scale(-1,1);
      ctx.drawImage(img,left,top,288,328,-W/2,41-FLOOR,W,H);
      if(sprite.prop&&art[sprite.prop.pose]) {
        const prop=sprite.prop,source=art[prop.pose];
        const [px,py,pw,ph]=prop.crop;
        const center=prop.crouch?72:95;
        ctx.save();
        if(!prop.crouch) {
          ctx.beginPath();
          ctx.rect(-W/2,41-FLOOR,W,128);
          ctx.clip();
        }
        ctx.drawImage(source.img,source.left+px*4,source.top+py*4,pw*4,ph*4,
          center-pw-W/2,128-ph*2+41-FLOOR,pw*2,ph*2);
        ctx.restore();
      }
      if(animate&&!beingCarried&&drawTime<blinkUntil&&eyelids[pose]) {
        for(const [x,y,w,h] of eyelids[pose]) {
          const left=x*2-W/2,top=y*2+41-FLOOR;
          ctx.fillStyle='#fcd4c4';
          ctx.fillRect(left,top,w*2,h*2);
          ctx.fillStyle='#34140c';
          ctx.fillRect(left,top+2,w*2,2);
        }
      }
      ctx.restore();
      visual=frame;
    }
    const mix=(from,to,p)=>from+(to-from)*p;
    const ease=p=>p*p*(3-2*p);
    function drawSprite(pose,dy=0,tilt=0) {
      const target={pose,x:W/2,y:FLOOR-41+dy,tilt};
      if(!bridge||bridge.poses||reduced.matches) {drawFrame(target);return;}
      const p=clamp((drawTime-bridge.start)/bridge.duration,0,1);
      if(p===1) {bridge=null;drawFrame(target);return;}
      const progress=ease(p);
      const reveal=bridge.thinking?progress:ease(clamp((p-.22)/.53,0,1));
      const from=bridge.from;
      const interpolated={pose:reveal<.5?from.pose:target.pose};
      for(const key of ['x','y','tilt']) interpolated[key]=mix(from[key],target[key],progress);
      if(!bridge.thinking) interpolated.tilt+=.11*Math.sin(p*TAU)*Math.sin(p*Math.PI);
      drawFrame(interpolated);
    }
    function buildBagIntro(from,to,outgoing,incoming,now,shown) {
      const wasSeated=seated.has(from);
      const frames=[{pose:shown,held:outgoing,seated:wasSeated}];
      function append(pose,held=null,low=false) {
        if(frames.at(-1).pose!==pose) frames.push({pose,held,seated:low});
      }
      if(outgoing) {
        const [half,ready]=bagPoses[outgoing];
        // A seated prop's ready drawing also works in reverse as he starts to rise.
        if(shown!==half) append(ready,outgoing,wasSeated);
        append(half,outgoing);
        append('bagFlap');
        append('bagClose');
        if(!incoming) {
          append('bagPat');
          append('standSettle');
        }
      } else if(wasSeated) append('bagRise');
      if(incoming) {
        const [half,ready]=bagPoses[incoming];
        append('bagReach');
        append('bagOpen');
        if(!outgoing) append('bagLook');
        append(half,incoming);
        append(ready,incoming,seated.has(to));
      } else if(seated.has(to)) append('land',null,true);
      const hold=frames.length>=9?140:bagFrameMs;
      return {frames,incoming,start:now,duration:frames.length*hold,hold,held:outgoing,seated:wasSeated,
        initialTilt:visual?.tilt??0};
    }
    function drawTimedPoses(frames,time,tilt=0,x=W/2) {
      const nextIndex=frames.findIndex(([at])=>at>time);
      const lastIndex=frames.length-1;
      const index=nextIndex<0?lastIndex:Math.max(0,nextIndex-1);
      const pose=frames[index][1];
      drawFrame({pose,x,y:FLOOR-41,tilt});
    }
    function drawProp(kind,x,y,size=1,alpha=1) {
      const [pixels,color]=propPixels[kind];
      ctx.globalAlpha=clamp(alpha,0,1);
      for(let row=0;row<pixels.length;row++) {
        for(let col=0;col<pixels[row].length;col++) {
          if(pixels[row][col]!=='1') continue;
          ctx.fillStyle=palette.ink;
          ctx.fillRect(Math.round(x)+col*size-1,Math.round(y)+row*size-1,size+2,size+2);
        }
      }
      ctx.fillStyle=color;
      for(let row=0;row<pixels.length;row++) {
        for(let col=0;col<pixels[row].length;col++) {
          if(pixels[row][col]==='1') ctx.fillRect(Math.round(x)+col*size,Math.round(y)+row*size,size,size);
        }
      }
      ctx.globalAlpha=1;
    }
    function drawBagIntro(now) {
      const intro=bagIntro;
      const index=Math.max(0,Math.min(intro.frames.length-1,Math.floor((now-intro.start)/intro.hold)));
      const {pose,held,seated:low}=intro.frames[index];
      intro.held=held;
      intro.seated=low;
      drawFrame({pose,x:W/2,y:FLOOR-41,tilt:index===0?intro.initialTilt:0});
    }
    function drawPlane(p) {
      if(reduced.matches) {drawSprite('planeHold');return;}
      const throwTilt=.06*Math.exp(-180*(p-.16)**2)-.041*Math.exp(-240*(p-.11)**2);
      drawTimedPoses(planeFrames,p,throwTilt);
      if(p>=.16&&p<.48) {
        const q=(p-.16)/.32;
        drawProp('paper',mix(23,-19,q),105-Math.sin(q*Math.PI*.73)*34-q*21,2,1);
      }
    }

    function drawWake(now) {
      const p=clamp((now-started)/current.duration,0,1);
      if(reduced.matches) {drawSprite('awake');return;}
      const rub=ease(clamp(Math.min((p-.21)/.08,(.50-p)/.07),0,1));
      drawTimedPoses(wakeFrames,p,.019*rub*Math.sin((p-.29)*TAU*15));
    }
    let drawTime=0;
    function detailFor(id,p) {
      if(reduced.matches) return null;
      const press=id==='game'&&presses.some(([start,end])=>p>=start&&p<end);
      const camera=id==='photo'?ease(clamp(Math.min((p-.43)/.06,(.59-p)/.08),0,1)):0;
      return {press,camera};
    }

    function draw(now) {
      drawTime=now;
      ctx.setTransform(scale,0,0,scale,0,0);
      ctx.clearRect(0,0,W,H);
      if(!reduced.matches&&!paused&&now>=nextBlink) {
        blinkUntil=now+90+Math.random()*40;
        nextBlink=now+blinkGap();
      }
      if(bagIntro) {
        if(now<started&&!reduced.matches) {drawBagIntro(now);return;}
        bagIntro=null;
      }
      if(transition) {
        if(now<started&&!reduced.matches) {
          drawSprite(transitionPose(transition,now));
          return;
        }
        transition=null;
        now=Math.max(now,started);
      }
      const {id,duration}=current;
      if(bridge?.poses) {
        if(now<started) {
          const index=Math.max(0,Math.min(3,Math.floor((now-bridge.start)/180)));
          drawSprite(bridge.poses[index]);
          return;
        }
        bridge=null;
      }
      if(id==='wake') {drawWake(now);return;}
      if(id==='plane') {drawPlane(((now-started)%duration)/duration);return;}
      if(id==='read') {
        if(reduced.matches) drawSprite('bookRead');
        else drawTimedPoses(readFrames,(now-started)%duration);
        return;
      }
      const shot=groups.reactions.includes(id)&&id!=='drag';
      const p=reduced.matches?(shot ? .52 : .3):(shot?clamp((now-started)/duration,0,1):((now-started)%duration)/duration);
      const hop=Math.sin(p*Math.PI);
      const detail=detailFor(id,p);
      const clip=clips[id];
      const frame=reduced.matches?Math.floor(clip.length/2):Math.min(clip.length-1,Math.floor(Math.max(0,p)*clip.length));
      const inkPose=clip[frame];
      const hopPx=inkPose==='cheerJump'&&!reduced.matches?-8:0;
      const carryTilt=id==='drag'&&!reduced.matches?swing+.035*Math.sin(now/180):0;
      drawSprite(inkPose,hopPx,carryTilt);
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
    let tickFailed=false;
    function tick(raw) {
      if(dead) return;
      frame=requestAnimationFrame(tick);
      try {step(raw);} catch(error) {
        if(!tickFailed) {tickFailed=true;console.error('Faye frame skipped:',error);}
        dirty=true;
      }
    }
    function step(raw) {
      const now=clock(raw);
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
      if(current.id==='walk'&&now>=started&&!bagIntro&&!transition&&!pointer&&!paused&&!reduced.matches) {
        if(interactive) {
          const edge=Math.max(0,host.clientWidth-W);
          if(x<=0) walkDirection=1;
          else if(x>=edge) walkDirection=-1;
          position(x+walkDirection*18*dt,y);
        } else {
          const box=host.getBoundingClientRect();
          if(box.left<=8) walkDirection=1;
          else if(box.right>=innerWidth-8) walkDirection=-1;
          host.dispatchEvent(new CustomEvent('faye:walk',{detail:{dx:walkDirection*18*dt}}));
        }
      }
      carry*=Math.exp(-8*dt);
      swingVelocity=(swingVelocity+(carry-swing)*54*dt)*Math.exp(-7*dt);
      swing=clamp(swing+swingVelocity*dt,-.22,.22);
      const interval=bridge||bagIntro||pointer||current.id==='drop'||current.id==='wake'||current.id==='plane'?1000/40:1000/30;
      if(dirty||(!paused&&!reduced.matches&&raw-last>=interval)) {draw(now);last=raw;dirty=false;}
      // next frame is already scheduled by tick()
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
    const layout=new ResizeObserver(()=>{fit();position(x,y);});
    addEventListener('resize',fit,{signal});
    layout.observe(host);
    fit();
    position((host.clientWidth-W)/2,(host.clientHeight-H)/2);
    canvas.hidden=true;canvas.style.display='none';
    const ready=loadArt().then(result=>{
      if(dead)return;
      art=result;canvas.hidden=false;canvas.style.display='block';
      if(auto&&next===Infinity&&current.id==='breathe') {resting=!!rest;next=clock()+restFor();}
      frame=requestAnimationFrame(tick);
    });
    return {ready,play,setMode,doze,wake,grab,carry:carryBy,release,pause,talk,element:canvas,
      get asleep(){return napping;},get current(){return current.id;},destroy(){
      dead=true;events.abort();layout.disconnect();cancelAnimationFrame(frame);canvas.remove();host.style.position=previousPosition;
    }};
  }
  window.FayeCompanion=Object.freeze({mount,actions,groups});
})();
