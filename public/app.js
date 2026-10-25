'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const path = location.pathname.split('/').filter(Boolean);
  const roomId = path[1] || '';
  const state = {id:null,token:null,name:'',stream:null,remoteStream:null,localLive:false,remoteLive:false,remoteId:null,pc:null,sse:null,ice:[],pendingIce:[],remoteHasDescription:false,makingOffer:false,connecting:false,polite:false,ignoreOffer:false,isSettingRemoteAnswerPending:false,needsNegotiation:false,iceRetries:0,iceRetryTimer:null,config:{iceServers:[{urls:'stun:stun.l.google.com:19302'}]},senders:null,quality:{height:1080,fps:60,bitrate:8500}};
  let toastTimer, statsTimer;
  function show(id,on){$(id).classList.toggle('hidden',!on);}
  function text(id,str){$(id).textContent=str;}
  function toast(msg){text('toast',msg);show('toast',true);clearTimeout(toastTimer);toastTimer=setTimeout(()=>show('toast',false),4000);}
  async function request(url,method,body){const res=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});let data={};try{data=await res.json();}catch{}if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);return data;}
  const get=url=>request(url,'GET');
  const post=(url,data)=>request(url,'POST',data);
  const invite=()=>`${location.origin}/room/${roomId}`;
  function label(){text('signalLabel',state.sse?.readyState===EventSource.OPEN?'● Sala conectada':'Reconectando...');}
  async function send(event,data={}){return post('/api/emit',{room:roomId,peer:state.id,token:state.token,event,...data});}
  async function signal(data){if(!state.remoteId)return;try{await send('signal',{to:state.remoteId,data});}catch(err){console.warn('Sinalização:',err.message);}}
  function setLocalLive(live){state.localLive=!!live;text('liveBadge',live?'● TRANSMITINDO':'● OFFLINE');$('liveBadge').classList.toggle('active',live);}
  function presentLocal(on){$('localVideo').classList.toggle('has-video',on);show('localEmpty',!on);show('localOverlay',on);}
  function presentRemote(on){$('remoteVideo').classList.toggle('has-video',on);show('remoteEmpty',!on);show('remoteOverlay',on);}
  function remoteWaiting(title,message){text('remoteTitle',title);text('remoteText',message);text('remoteHint',title);text('remoteTag','AGUARDANDO');}
  function updateRemote(){
    if(!state.remoteId){presentRemote(false);remoteWaiting('Aguardando seu amigo','Envie o link da sala para ele entrar.');return;}
    if(!state.remoteLive){presentRemote(false);remoteWaiting('Amigo conectado','Ele ainda não iniciou a transmissão.');return;}
    const track=$('remoteVideo').srcObject?.getVideoTracks()[0];
    if(!track||track.muted||track.readyState!=='live'){presentRemote(false);remoteWaiting('Conectando ao vídeo...','Se não aparecer, clique em Reconectar vídeo. Se persistir, pode ser necessário TURN.');return;}
    presentRemote(true);text('remoteTag','AO VIVO');text('remoteHint','Transmitindo para você');
  }
  async function copyLink(){try{await navigator.clipboard.writeText(invite());toast('Link da sala copiado!');}catch{$('roomLink').focus();$('roomLink').select();toast('Copie o link selecionado.');}}
  async function fullscreen(id){const el=$(id);try{if(document.fullscreenElement)await document.exitFullscreen();else await el.requestFullscreen();}catch{toast('Tela cheia indisponível.');}}
  function appendChat({nickname,message,date,from}){const row=document.createElement('div');row.className='chat-entry';const name=document.createElement('span');name.className='name'+(from===state.id?' host':'');name.textContent=nickname;const time=document.createElement('span');time.className='time';time.textContent=new Date(date).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});const msg=document.createElement('p');msg.textContent=message;row.append(name,time,msg);$('chatMessages').append(row);$('chatMessages').scrollTop=$('chatMessages').scrollHeight;}
  async function applyBitrate(){if(!state.senders?.video)return;try{const sender=state.senders.video;const params=sender.getParameters();if(!params.encodings?.length)params.encodings=[{}];params.encodings[0].maxBitrate=state.quality.bitrate*1000;params.encodings[0].maxFramerate=state.quality.fps;params.degradationPreference='maintain-framerate';await sender.setParameters(params);}catch(e){console.info('Bitrate controlado pelo navegador:',e.message);}}

  function endPeer(){
    clearTimeout(state.iceRetryTimer);state.iceRetryTimer=null;
    if(state.pc){try{state.pc.onicecandidate=null;state.pc.ontrack=null;state.pc.onconnectionstatechange=null;state.pc.close();}catch{}state.pc=null;}
    state.senders=null;state.pendingIce=[];state.remoteHasDescription=false;state.makingOffer=false;state.connecting=false;state.ignoreOffer=false;state.isSettingRemoteAnswerPending=false;state.needsNegotiation=false;state.iceRetries=0;
    state.remoteStream=null;$('remoteVideo').srcObject=null;presentRemote(false);
  }
  async function addIce(candidate){if(!state.pc){state.pendingIce.push(candidate);return;}if(!state.pc.remoteDescription){state.pendingIce.push(candidate);return;}try{await state.pc.addIceCandidate(candidate);}catch(e){if(!state.ignoreOffer)console.warn('ICE:',e.message);}}
  async function flushIce(){const all=state.pendingIce.splice(0);for(const candidate of all)await addIce(candidate);}
  function ensurePeer(){
    if(!state.remoteId || state.pc)return;
    // Perfect Negotiation: os dois podem oferecer mídia sem disputar o SDP.
    state.polite=state.id>state.remoteId;
    const pc=new RTCPeerConnection({iceServers:state.config.iceServers||[]});state.pc=pc;
    const video=pc.addTransceiver('video',{direction:'sendrecv'});
    const audio=pc.addTransceiver('audio',{direction:'sendrecv'});
    state.senders={video:video.sender,audio:audio.sender};
    pc.onicecandidate=e=>{if(e.candidate)signal({type:'ice',candidate:e.candidate.toJSON()});};
    pc.ontrack=e=>{
      if(!state.remoteStream)state.remoteStream=new MediaStream();
      if(!state.remoteStream.getTracks().some(track=>track.id===e.track.id))state.remoteStream.addTrack(e.track);
      const player=$('remoteVideo');player.srcObject=state.remoteStream;
      e.track.addEventListener('unmute',()=>{if(e.track.kind==='video'){updateRemote();player.play().catch(()=>{});}});
      e.track.addEventListener('mute',()=>{if(e.track.kind==='video')updateRemote();});
      e.track.addEventListener('ended',()=>{if(e.track.kind==='video')updateRemote();});
      updateRemote();player.play().catch(()=>{});
    };
    // Quando os dois compartilham depois de entrarem, é essencial renegociar.
    pc.onnegotiationneeded=()=>makeOffer().catch(e=>console.warn('Renegociação:',e));
    pc.onconnectionstatechange=()=>{
      if(pc!==state.pc)return;
      if(pc.connectionState==='connected'){
        state.iceRetries=0;clearTimeout(state.iceRetryTimer);
        text('signalLabel','● Vídeo conectado');
      }else if(pc.connectionState==='failed'){
        text('signalLabel','● Falha no vídeo');
        retryIce(pc);
      }else if(pc.connectionState==='disconnected'){
        text('signalLabel','● Tentando reconectar...');
        clearTimeout(state.iceRetryTimer);
        state.iceRetryTimer=setTimeout(()=>{if(state.pc===pc&&pc.connectionState!=='connected')retryIce(pc);},4500);
      }
    };
    if(state.stream)attachTracks().catch(e=>console.warn('Mídia local:',e));
  }
  async function attachTracks(){
    if(!state.senders)return;
    const stream=state.stream;
    await state.senders.video.replaceTrack(stream?.getVideoTracks()[0]||null);
    await state.senders.audio.replaceTrack(stream?.getAudioTracks()[0]||null);
    if(stream)await applyBitrate();
  }
  async function makeOffer(){
    const pc=state.pc;
    if(!pc||pc.signalingState==='closed')return;
    // As ofertas pendentes são enviadas assim que a negociação atual terminar.
    if(state.makingOffer||pc.signalingState!=='stable'||state.isSettingRemoteAnswerPending){state.needsNegotiation=true;return;}
    state.makingOffer=true;
    try{
      await pc.setLocalDescription(await pc.createOffer());
      // Se o navegador recuou uma oferta simultânea, não envie um SDP antigo.
      if(pc!==state.pc||pc.signalingState!=='have-local-offer')return;
      const description={type:'offer',sdp:pc.localDescription.sdp};
      await signal({type:'offer',description});
    }finally{state.makingOffer=false;}
  }
  function flushOffer(){
    if(!state.needsNegotiation)return;
    state.needsNegotiation=false;
    setTimeout(()=>makeOffer().catch(e=>console.warn('Oferta pendente:',e)),150);
  }
  async function retryIce(pc,manual=false){
    if(pc!==state.pc||pc.signalingState==='closed')return;
    if(!manual&&state.iceRetries>=2){
      text('signalLabel','● Rede bloqueando vídeo — TURN pode ser necessário');
      return;
    }
    state.iceRetries++;
    try{pc.restartIce();await makeOffer();if(manual)toast('Reconectando os vídeos...');}
    catch(e){console.warn('ICE restart:',e);if(manual)toast('Falha ao reconectar: '+e.message);}
  }
  async function acceptSignal(from,data){
    if(from!==state.remoteId)return;
    if(data.type==='ice'){
      if(data.candidate&&!state.ignoreOffer)await addIce(data.candidate);
      return;
    }
    ensurePeer();const pc=state.pc;if(!pc||!data.description)return;
    if(data.type==='offer'){
      const collision=state.makingOffer||pc.signalingState!=='stable';
      state.ignoreOffer=!state.polite&&collision;
      if(state.ignoreOffer)return;
      // setRemoteDescription faz rollback automático em ofertas simultâneas.
      await pc.setRemoteDescription(data.description);
      state.ignoreOffer=false;
      state.remoteHasDescription=true;await flushIce();
      await pc.setLocalDescription(await pc.createAnswer());
      await signal({type:'answer',description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});
      flushOffer();
    }else if(data.type==='answer'){
      state.ignoreOffer=false;
      if(pc.signalingState!=='have-local-offer')return;
      state.isSettingRemoteAnswerPending=true;
      try{await pc.setRemoteDescription(data.description);state.remoteHasDescription=true;await flushIce();}
      finally{state.isSettingRemoteAnswerPending=false;}
      flushOffer();
    }
  }
  async function startScreen(){
    if(!navigator.mediaDevices?.getDisplayMedia){toast('Use Chrome/Edge atualizado e HTTPS.');return;}
    if(state.stream)return;
    const [height,fps,baseline]=$('qualitySelect').value.split(':').map(Number);
    const bitrate=Number($('bitrateSelect').value||baseline);state.quality={height,fps,bitrate};
    $('startBtn').disabled=true;
    try{
      const stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:Math.round(height*16/9)},height:{ideal:height},frameRate:{ideal:fps,max:fps}},audio:$('shareAudio').checked,systemAudio:$('shareAudio').checked?'include':'exclude',surfaceSwitching:'include',selfBrowserSurface:'exclude'});
      state.stream=stream;
      stream.getVideoTracks()[0]?.addEventListener('ended',()=>stopScreen(),{once:true});
      $('localVideo').srcObject=stream;presentLocal(true);
      await $('localVideo').play().catch(()=>{});
      await attachTracks();
      await makeOffer();
      setLocalLive(true);show('startBtn',false);show('stopBtn',true);
      text('qualityTag',`${height}P · ${fps} FPS`);text('resolutionOverlay',`${height}p / ${fps} FPS`);
      text('localHint','Compartilhando sua tela');
      try{await send('live',{live:true});}catch(err){toast(`Sinalização indisponível: ${err.message}`);}
      startStats();toast('Sua tela está sendo compartilhada.');
    }catch(e){if(e.name!=='NotAllowedError')toast(`Erro na captura: ${e.message}`);else toast('Você cancelou a escolha da tela.');if(state.stream)await stopScreen();}
    finally{$('startBtn').disabled=false;}
  }
  async function stopScreen(){
    const stream=state.stream;if(!stream)return;state.stream=null;
    clearInterval(statsTimer);
    for(const track of stream.getTracks())try{track.stop();}catch{}
    try{await attachTracks();await makeOffer();}catch{}
    $('localVideo').srcObject=null;presentLocal(false);setLocalLive(false);
    show('startBtn',true);show('stopBtn',false);text('qualityTag','PRONTA');text('localHint','Sua tela não está sendo enviada');text('statsLine','Pronto para transmitir');
    try{await send('live',{live:false});}catch{}
  }
  function startStats(){clearInterval(statsTimer);let lastBytes=0,lastTime=0;statsTimer=setInterval(async()=>{
    if(!state.stream)return;
    const cfg=state.stream.getVideoTracks()[0]?.getSettings()||{};
    let line=`${cfg.width||'?'} × ${cfg.height||'?'} · ${cfg.frameRate?Math.round(cfg.frameRate):'?'} FPS`;const pc=state.pc;
    if(pc){try{const stats=await pc.getStats();for(const r of stats.values()){if(r.type==='outbound-rtp'&&r.kind==='video'&&r.bytesSent){if(lastTime&&r.timestamp>lastTime){line+=` · ${((r.bytesSent-lastBytes)*8/(r.timestamp-lastTime)/1000).toFixed(1)} Mb/s`;}lastBytes=r.bytesSent;lastTime=r.timestamp;break;}}}catch{}}
    text('statsLine',line);
  },2500);}
  async function onEvent(e){
    switch(e.type){
      case 'ready': {
        text('viewerCount',e.room.online);const peer=e.peers?.[0];
        if(peer){if(state.remoteId!==peer.id){endPeer();state.remoteId=peer.id;}state.remoteLive=peer.live;ensurePeer();}
        else {state.remoteId=null;state.remoteLive=false;endPeer();}
        updateRemote();break;
      }
      case 'peer-joined':
        if(e.peer===state.id)break;
        if(state.remoteId!==e.peer){endPeer();state.remoteId=e.peer;}
        state.remoteLive=!!e.live;ensurePeer();updateRemote();break;
      case 'peer-left':if(e.peer===state.remoteId){endPeer();state.remoteId=null;state.remoteLive=false;updateRemote();}break;
      case 'presence':text('viewerCount',e.online);break;
      case 'peer-live':if(e.peer===state.remoteId){state.remoteLive=e.live;updateRemote();}break;
      case 'signal':await acceptSignal(e.from,e.data);break;
      case 'chat':appendChat(e);break;
    }
  }
  async function init(){
    try{
      const info=await get(`/api/rooms/${roomId}`);text('roomTitle',info.name);
      const key=`neri-duo:${roomId}`;let creds={};try{creds=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
      let joined;
      try{joined=await post(`/api/rooms/${roomId}/join`,creds);}catch(err){if(err.message.includes('Sala cheia')){connectionError('Sala cheia','Esta sala permite apenas duas pessoas.');return;}throw err;}
      state.id=joined.peer;state.token=joined.token;sessionStorage.setItem(key,JSON.stringify({peer:joined.peer,token:joined.token}));
      const conf=await get('/api/config');state.config=conf;
      const qs=new URLSearchParams({room:roomId,peer:state.id,token:state.token});
      const sse=new EventSource(`/api/events?${qs}`);state.sse=sse;
      sse.onopen=label;sse.onerror=()=>text('signalLabel','Reconectando...');
      sse.onmessage=e=>{let parsed;try{parsed=JSON.parse(e.data);}catch{return;}onEvent(parsed).catch(err=>console.warn('NERI LIVE:',err));};
    }catch(err){connectionError('Não foi possível entrar',err.message);}
  }
  function connectionError(title,message){text('roomTitle',title);text('signalLabel','● Desconectado');remoteWaiting(title,message);toast(message);$('startBtn').disabled=true;}
  if(!roomId){show('landing',true);$('createForm').addEventListener('submit',async e=>{
    e.preventDefault();const btn=$('createBtn');btn.disabled=true;btn.textContent='Criando sala...';
    try{const room=await post('/api/rooms',{name:$('roomName').value});location.href=room.url;}
    catch(err){toast(err.message);btn.disabled=false;btn.textContent='Criar sala ↗';}
  });return;}
  show('roomApp',true);$('roomLink').value=invite();
  const nick=localStorage.getItem('neri-live-nickname');if(nick)$('nickname').value=nick;
  $('nickname').addEventListener('change',()=>localStorage.setItem('neri-live-nickname',$('nickname').value));
  $('copyLink').addEventListener('click',copyLink);$('copyLinkTop').addEventListener('click',copyLink);
  $('fullscreenLocal').addEventListener('click',()=>fullscreen('localVideo'));
  $('fullscreenRemote').addEventListener('click',()=>fullscreen('remoteVideo'));
  $('audioBtn').addEventListener('click',async()=>{$('remoteVideo').muted=false;try{await $('remoteVideo').play();toast('Áudio da transmissão ativado.');show('audioBtn',false);}catch{toast('O áudio não pôde ser iniciado.');}});
  $('startBtn').addEventListener('click',startScreen);$('stopBtn').addEventListener('click',stopScreen);
  $('chatForm').addEventListener('submit',async e=>{e.preventDefault();const inp=$('chatInput');const message=inp.value.trim();if(!message)return;try{await send('chat',{nickname:$('nickname').value||'Convidado',message});inp.value='';}catch(err){toast(err.message);}});
  $('remoteVideo').addEventListener('loadedmetadata',()=>{if(state.remoteLive){presentRemote(true);text('remoteTag','AO VIVO');show('audioBtn',true);}});
  // Controle de recuperação, caso o vídeo falhe em alguma das redes.
  const retryBtn=document.createElement('button');retryBtn.className='btn-small';retryBtn.type='button';
  retryBtn.textContent='↻ Reconectar vídeo';retryBtn.style.marginLeft='8px';
  $('signalLabel').insertAdjacentElement('afterend',retryBtn);
  retryBtn.addEventListener('click',async()=>{
    if(!state.remoteId){toast('Aguarde seu amigo entrar na sala.');return;}
    if(!state.pc)ensurePeer();
    await retryIce(state.pc,true);
  });
  document.querySelector('.version').textContent='v3.1';
  window.addEventListener('beforeunload' ,()=>{for(const t of state.stream?.getTracks()||[])t.stop();state.sse?.close();endPeer();});
  init();
})();
