'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const path = location.pathname.split('/').filter(Boolean);
  const mode = path[0] === 'studio' ? 'host' : path[0] === 'watch' ? 'viewer' : 'landing';
  const roomId = path[1] || '';
  const hostKey = new URLSearchParams(location.hash.substring(1)).get('key') || '';
  const state = {room:null, mode, stream:null, live:false, sse:null, peers:new Map(), knownViewers:new Set(),config:{iceServers:[{urls:'stun:stun.l.google.com:19302'}]}, peerId:'v-'+makeId(), joined:false, earlyIce:[], quality:{height:1080,fps:60,bitrate:8500}};
  let toastTimer,statsTimer;

  function makeId(){return (typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function' ? crypto.randomUUID().replace(/-/g,'') : `${Date.now()}${Math.random().toString(36).slice(2)}`);}
  function toast(msg){$('toast').textContent=msg;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),4100);}
  function text(id,value){$(id).textContent=value;}
  function toggle(id,on){$(id).classList.toggle('hidden',!on);}
  function safeFetch(path,opts){return fetch(path,opts).then(async res=>{let json;try{json=await res.json();}catch{json={};}if(!res.ok)throw Error(json.error||`Erro HTTP ${res.status}`);return json;});}
  const get = path=>safeFetch(path);
  const post=(path,data)=>safeFetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const watchLink=()=>`${location.origin}/watch/${roomId}`;
  function connectionState(label){text('signalLabel',label);}
  function setLive(live){state.live=!!live;text('liveBadge',live?'● AO VIVO':'● OFFLINE');$('liveBadge').classList.toggle('active',!!live);}
  function showVideo(hasVideo){$('streamVideo').classList.toggle('has-video',hasVideo);toggle('playerEmpty',!hasVideo);toggle('videoOverlay',hasVideo);}
  function fpsOptions(){const [height,fps,bitrate]=$('qualitySelect').value.split(':').map(Number);return {height,fps,bitrate:Number($('bitrateSelect').value||bitrate)};}

  $('createForm').addEventListener('submit',async e=>{
    e.preventDefault();const btn=$('createBtn');btn.disabled=true;text('createBtn','Criando sala...');
    try{const room=await post('/api/rooms',{name:$('roomName').value});location.href=room.studio;}catch(err){toast(err.message);btn.disabled=false;$('createBtn').innerHTML='Criar sala <span>↗</span>';}
  });
  if(mode==='landing'){$('landing').classList.remove('hidden');return;}
  $('roomApp').classList.remove('hidden');toggle('studioPanel',mode==='host');
  text('roomType',mode==='host'?'ESTÚDIO':'ASSISTINDO');
  text('playerLabel',mode==='host'?'PRÉVIA DA SUA TELA':'TRANSMISSÃO AO VIVO');
  text('playerHint',mode==='host'?'Seu monitor fica visível apenas depois de clicar em iniciar.':'Conexão de vídeo ponto a ponto • WebRTC');
  if(mode==='viewer'){
    text('emptyTitle','Aguardando transmissão');text('emptyText','Quando o anfitrião iniciar a tela, você verá a imagem aqui.');
    text('qualityTag','WEBRTC · LOW LATENCY');
  }
  $('roomLink').value=watchLink();
  $('nickname').value=localStorage.getItem('neri-live-nickname')||'';
  $('nickname').addEventListener('change',()=>localStorage.setItem('neri-live-nickname',$('nickname').value));
  $('fullscreenBtn').addEventListener('click',()=>{
    const elem=$('streamVideo').classList.contains('has-video')?$('streamVideo'):$('playerEmpty').parentElement;
    if(document.fullscreenElement){document.exitFullscreen?.();}else elem.requestFullscreen?.().catch(()=>toast('Tela cheia indisponível.'));
  });
  async function copyLink(){const url=watchLink();try{await navigator.clipboard.writeText(url);toast('Link do espectador copiado!');}catch{window.prompt('Copie o link para seus amigos:',url);}}
  $('copyLink').addEventListener('click',copyLink);$('copyLinkTop').addEventListener('click',copyLink);
  $('audioBtn').addEventListener('click',async()=>{
    const video=$('streamVideo');video.muted=!video.muted;
    if(video.muted)text('audioBtn','Ativar áudio 🔊');else text('audioBtn','Silenciar 🔇');
    try{await video.play();}catch{toast('Clique no vídeo para iniciar o áudio.');}
  });
  $('qualitySelect').addEventListener('change',()=>{
    const [height,fps,bitrate]=$('qualitySelect').value.split(':').map(Number);
    $('bitrateSelect').value=String(bitrate);
    text('qualityTag',`${height}P · ${fps} FPS`);
  });

  $('chatForm').addEventListener('submit',async e=>{
    e.preventDefault();const message=$('chatInput').value.trim();if(!message)return;
    const nickname=$('nickname').value.trim()||'Convidado';localStorage.setItem('neri-live-nickname',nickname);
    $('chatInput').value='';
    try{await emit('chat',{nickname,message});}catch(err){toast(err.message);$('chatInput').value=message;}
  });
  function addChat(m){
    const list=$('chatMessages');const row=document.createElement('div');row.className='chat-entry';
    const top=document.createElement('div');const name=document.createElement('span');name.className='name'+(m.host?' host':'');name.textContent=m.nickname+(m.host?' ★':'');
    const time=document.createElement('span');time.className='time';time.textContent=new Date(m.date).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    top.append(name,time);const p=document.createElement('p');p.textContent=m.message;row.append(top,p);list.append(row);
    while(list.children.length>101)list.children[1]?.remove();list.scrollTop=list.scrollHeight;
  }
  function emit(event,extra={}) {return post('/api/emit',{room:roomId,role:mode,peer:state.peerId,key:mode==='host'?hostKey:undefined,event,...extra});}
  const signal=(to,data)=>emit('signal',{to,data});

  async function init(){
    if(mode==='host'&&!hostKey){connectionState('Link do estúdio sem chave');toast('Chave ausente. Crie outra sala na página inicial.');$('startBtn').disabled=true;return;}
    try{
      const [room,config]=await Promise.all([get(`/api/rooms/${roomId}`),get('/api/config')]);
      state.room=room;state.config=config;text('roomTitle',room.name);document.title=`${room.name} • NERI LIVE`;
      setLive(room.live);text('viewerCount',room.viewers);
      if(mode==='host'){$('startBtn').addEventListener('click',startScreen);$('stopBtn').addEventListener('click',stopScreen);}
      connectEvents();
    } catch(err){connectionState('Sala não encontrada');toast(`${err.message} — a sala pode ter expirado.`);text('emptyTitle','Sala indisponível');text('emptyText','Peça um link atualizado para o anfitrião.');}
  }
  function connectEvents(){
    const qs=new URLSearchParams({room:roomId,role:mode});
    if(mode==='host')qs.set('key',hostKey);else qs.set('peer',state.peerId);
    const sse=new EventSource(`/api/events?${qs.toString()}`);state.sse=sse;
    sse.onopen=()=>connectionState('● Conectado');
    sse.onmessage=async e=>{let m;try{m=JSON.parse(e.data);}catch{return;}try{await onEvent(m);}catch(err){console.warn('NERI LIVE:',err);}};
    sse.onerror=()=>{connectionState('Reconectando...');if(mode==='viewer'&&!state.live)text('emptyText','Tentando reconectar à sala...');};
    // Presença real de quem está com a transmissão aberta: atualiza o servidor
    // durante sessões ativas e ajuda a detectar desconexões em hospedagem gratuita.
    setInterval(()=>{
      if(state.sse?.readyState===EventSource.OPEN) emit('heartbeat').catch(()=>{});
    }, 4*60*1000);
  }
  async function onEvent(m){
    switch(m.type){
      case 'ready':
        text('viewerCount',m.count);
        if(mode==='host'){
          const next=new Set(m.viewers||[]);
          for(const peer of [...state.peers.keys()])if(!next.has(peer))dropPeer(peer);
          state.knownViewers=next;
          if(state.stream)for(const id of next)await prepareHostPeer(id);
          // Uma transmissão reiniciada não é recuperável sem nova captura.
          if(m.live&&!state.stream)await emit('live',{live:false});
        }else{setLive(m.live);if(!m.hostOnline)connectionState('Aguardando anfitrião');}
        break;
      case 'viewer-joined':
        if(mode==='host'){state.knownViewers.add(m.peer);if(state.stream)await prepareHostPeer(m.peer);}
        break;
      case 'viewer-left':if(mode==='host'){state.knownViewers.delete(m.peer);dropPeer(m.peer);}break;
      case 'count':text('viewerCount',m.count);break;
      case 'live':setLive(m.live);if(mode==='viewer'){
        if(!m.live){dropAllPeers();showVideo(false);text('emptyTitle','Transmissão encerrada');text('emptyText','O anfitrião ainda pode iniciar uma nova transmissão.');}
        else if(!state.peers.size){text('emptyTitle','Conectando ao vídeo...');text('emptyText','Estabelecendo conexão WebRTC.');}
      }break;
      case 'host-offline':if(mode==='viewer'){setLive(false);dropAllPeers();showVideo(false);text('emptyTitle','Anfitrião desconectado');}break;
      case 'host-online':if(mode==='viewer')connectionState('● Sala conectada');break;
      case 'signal':await receiveSignal(m.from,m.data);break;
      case 'chat':addChat(m);break;
      case 'replaced':toast('O estúdio foi aberto em outra aba.');break;
    }
  }
  function newPC(id){
    const pc=new RTCPeerConnection({iceServers:state.config.iceServers||[],bundlePolicy:'max-bundle'});
    const wrapper={pc,pending:[],id};state.peers.set(id,wrapper);
    pc.onicecandidate=event=>{if(event.candidate)signal(id,{type:'ice',candidate:event.candidate.toJSON()}).catch(()=>{});};
    pc.onconnectionstatechange=()=>{
      if(mode==='viewer'){
        if(pc.connectionState==='connected')connectionState('● Vídeo conectado');
        else if(['failed','disconnected'].includes(pc.connectionState))connectionState('● Oscilação de conexão');
      }
      if(pc.connectionState==='failed'){
        // Ofertas novas reconectam na próxima sessão; evita loop de renegociação.
        if(mode==='host')dropPeer(id);
      }
    };
    if(mode==='viewer')pc.ontrack=async event=>{
      if(!event.streams?.length)return;
      const video=$('streamVideo');video.srcObject=event.streams[0];video.muted=true;
      showVideo(true);toggle('audioBtn',true);text('emptyTitle','Conectando ao vídeo...');
      try{await video.play();}catch{toast('Clique em “Ativar áudio” para iniciar a reprodução.');}
    };
    return wrapper;
  }
  async function prepareHostPeer(id){
    if(!state.stream||state.peers.has(id))return;
    const wrapper=newPC(id),pc=wrapper.pc;
    for(const track of state.stream.getTracks())pc.addTrack(track,state.stream);
    const videoSender=pc.getSenders().find(s=>s.track?.kind==='video');
    if(videoSender){try{let pars=videoSender.getParameters();if(!pars.encodings?.length)pars.encodings=[{}];pars.encodings[0].maxBitrate=state.quality.bitrate*1000;pars.encodings[0].maxFramerate=state.quality.fps;pars.degradationPreference='maintain-framerate';await videoSender.setParameters(pars);}catch(err){console.warn('Bitrate:',err.message);}}
    try{
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      await signal(id,{type:'offer',description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});
    }catch(err){console.warn('Falha ao negociar:',err.message);dropPeer(id);}
  }
  async function receiveSignal(from,data){
    if(mode==='host'){
      const wrapper=state.peers.get(from);if(!wrapper)return;
      if(data.type==='answer'&&data.description){await wrapper.pc.setRemoteDescription(data.description);await flushIce(wrapper);}
      else if(data.type==='ice'&&data.candidate)await addIce(wrapper,data.candidate);
    }else{
      if(data.type==='offer'&&data.description){
        dropAllPeers();const wrapper=newPC('host');const pc=wrapper.pc;
        wrapper.pending.push(...state.earlyIce.splice(0));
        await pc.setRemoteDescription(data.description);await flushIce(wrapper);
        const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
        await signal('host',{type:'answer',description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});
      }else if(data.type==='ice'&&data.candidate){
        const wrapper=state.peers.get('host');if(wrapper)await addIce(wrapper,data.candidate);else state.earlyIce.push(data.candidate);
      }
    }
  }
  async function addIce(wrapper,candidate){
    if(!wrapper.pc.remoteDescription){wrapper.pending.push(candidate);return;}
    try{await wrapper.pc.addIceCandidate(candidate);}catch(err){console.warn('ICE:',err.message);}
  }
  async function flushIce(wrapper){const list=wrapper.pending.splice(0);for(const candidate of list)await addIce(wrapper,candidate);}
  function dropPeer(id){const wrapper=state.peers.get(id);if(!wrapper)return;wrapper.pc.ontrack=null;wrapper.pc.onicecandidate=null;wrapper.pc.close();state.peers.delete(id);}
  function dropAllPeers(){for(const id of [...state.peers.keys()])dropPeer(id);}

  async function startScreen(){
    if(!navigator.mediaDevices?.getDisplayMedia){toast('Use Chrome ou Edge atualizado, em localhost ou HTTPS.');return;}
    if(state.stream)return;
    const {height,fps,bitrate}=fpsOptions();state.quality={height,fps,bitrate};
    $('startBtn').disabled=true;
    try{
      const stream=await navigator.mediaDevices.getDisplayMedia({
        video:{width:{ideal:Math.round(height*16/9)},height:{ideal:height},frameRate:{ideal:fps,max:fps},cursor:'always'},
        audio:$('shareAudio').checked?{echoCancellation:false,noiseSuppression:false,autoGainControl:false}:false,
        systemAudio:$('shareAudio').checked?'include':'exclude',
        surfaceSwitching:'include',selfBrowserSurface:'exclude'
      });
      state.stream=stream;
      const displayTrack=stream.getVideoTracks()[0];
      displayTrack.addEventListener('ended',()=>stopScreen(),{once:true});
      $('streamVideo').srcObject=stream;$('streamVideo').muted=true;showVideo(true);
      toggle('startBtn',false);toggle('stopBtn',true);
      text('qualityTag',`${height}P · ${fps} FPS`);text('resolutionOverlay',`${height}p / ${fps}fps`);
      await $('streamVideo').play();
      await emit('live',{live:true});setLive(true);
      for(const id of state.knownViewers)await prepareHostPeer(id);
      toast('Sua tela está sendo transmitida.');
      startStats();
    }catch(err){
      if(state.stream)stopScreen();
      if(err.name!=='NotAllowedError')toast(`Não foi possível transmitir: ${err.message}`);
      else toast('Compartilhamento cancelado.');
    }finally{$('startBtn').disabled=false;}
  }
  async function stopScreen(){
    const had=!!state.stream;if(!had)return;
    const tracks=state.stream.getTracks();state.stream=null;
    for(const t of tracks)try{t.stop();}catch{}
    clearInterval(statsTimer);dropAllPeers();
    const video=$('streamVideo');video.pause();video.srcObject=null;showVideo(false);
    toggle('startBtn',true);toggle('stopBtn',false);
    text('statsLine','Transmissão encerrada');
    text('emptyTitle','Sua transmissão começa aqui');text('emptyText','Clique em iniciar para compartilhar novamente.');
    try{await emit('live',{live:false});}catch{}setLive(false);
    toast('Compartilhamento encerrado.');
  }
  function startStats(){clearInterval(statsTimer);let beforeTime=0,beforeBytes=0;
    statsTimer=setInterval(async()=>{
      if(!state.stream)return;const track=state.stream.getVideoTracks()[0];const settings=track?.getSettings()||{};
      let detail=`${settings.width||'?'}×${settings.height||'?'} · ${settings.frameRate?Math.round(settings.frameRate)+' FPS solicitado':'FPS variável'}`;
      const first=state.peers.values().next().value;
      if(first){try{const stats=await first.pc.getStats();for(const row of stats.values()){
        if(row.type==='outbound-rtp'&&row.kind==='video'&&row.bytesSent){
          if(beforeTime&&row.timestamp>beforeTime){const mbps=(row.bytesSent-beforeBytes)*8/(row.timestamp-beforeTime)/1000;detail+=` · ${mbps.toFixed(1)} Mb/s enviados`;}
          beforeTime=row.timestamp;beforeBytes=row.bytesSent;break;
        }
      }}catch{}}
      text('statsLine',detail);
    },2500);
  }
  window.addEventListener('beforeunload',()=>{if(state.stream)for(const track of state.stream.getTracks())track.stop();state.sse?.close();dropAllPeers();});
  init();
})();
