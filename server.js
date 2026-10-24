'use strict';
// NERI LIVE — servidor de sinalização leve, sem bibliotecas externas.
// A mídia WebRTC trafega entre os navegadores, não pelo servidor.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 4747);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const MAX_VIEWERS = 8; // P2P: cada espectador requer um stream de saída.
const TTL_MS = 12 * 60 * 60 * 1000;
const rooms = new Map();
const extensionType = { '.html': 'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
const iceServers = (() => { try { const v = JSON.parse(process.env.ICE_SERVERS_JSON || '[{"urls":"stun:stun.l.google.com:19302"}]'); return Array.isArray(v) ? v : []; } catch { return [{urls:'stun:stun.l.google.com:19302'}]; } })();
function respond(res, code, value) { const body=JSON.stringify(value); res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(body); }
function readBody(req) { return new Promise((resolve,reject)=>{let raw='';req.on('data',b=>{raw+=b;if(raw.length>65000){reject(new Error('Payload grande demais'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'))}catch{reject(new Error('JSON inválido'))}});req.on('error',reject);}); }
function roomPublic(room) { return {id:room.id,name:room.name,live:room.live,viewers:room.viewers.size,limit:MAX_VIEWERS}; }
function send(connection, data) { if (!connection || connection.res.destroyed) return; try { connection.res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} }
function broadcast(room,event) { send(room.host,event); for(const conn of room.viewers.values()) send(conn,event); }
function disconnectViewer(room,id,conn) { if(room.viewers.get(id)!==conn) return; room.viewers.delete(id);send(room.host,{type:'viewer-left',peer:id}); broadcast(room,{type:'count',count:room.viewers.size}); }
function disconnectHost(room,conn) { if(room.host!==conn)return;room.host=null;room.live=false;broadcast(room,{type:'live',live:false});broadcast(room,{type:'host-offline'}); }
function safeRoom(id) { return typeof id==='string'&&/^[a-zA-Z0-9_-]{6,32}$/.test(id) ? rooms.get(id) : undefined; }
function serveFile(res,file) { const full=path.join(PUBLIC,file); if(!full.startsWith(PUBLIC+path.sep))return respond(res,403,{error:'Acesso negado'});fs.readFile(full,(err,bytes)=>{if(err)return respond(res,404,{error:'Não encontrado'});res.writeHead(200,{'Content-Type':extensionType[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(bytes);}); }
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const url = new URL(req.url, 'http://localhost');
  if (req.method==='POST' && url.pathname==='/api/rooms') {
    try { const body=await readBody(req);let name=String(body.name||'Sala privada').replace(/[<>]/g,'').trim().slice(0,54);if(!name)name='Sala privada';
      const id='priv-'+crypto.randomBytes(7).toString('hex');const key=crypto.randomBytes(32).toString('base64url');
      rooms.set(id,{id,key,name,created:Date.now(),lastActivity:Date.now(),live:false,host:null,viewers:new Map()});
      return respond(res,201,{id,key,watch:`/watch/${id}`,studio:`/studio/${id}#key=${key}`});
    } catch{return respond(res,400,{error:'Não foi possível criar a sala'});}
  }
  if (req.method==='GET' && url.pathname==='/health')return respond(res,200,{status:'ok',app:'NERI LIVE',version:'2.0'});
  if (req.method==='GET' && url.pathname==='/api/config')return respond(res,200,{iceServers,maxViewers:MAX_VIEWERS});
  if (req.method==='GET' && url.pathname.startsWith('/api/rooms/')){
    const room=safeRoom(url.pathname.split('/')[3]);return room?respond(res,200,roomPublic(room)):respond(res,404,{error:'Sala não encontrada ou expirada'});
  }
  if (req.method==='GET' && url.pathname==='/api/events') {
    const room=safeRoom(url.searchParams.get('room'));const role=url.searchParams.get('role');const peer=url.searchParams.get('peer');
    if(!room)return respond(res,404,{error:'Sala não encontrada'});
    if(role!=='host'&&role!=='viewer')return respond(res,400,{error:'Papel inválido'});
    if(role==='host'&&url.searchParams.get('key')!==room.key)return respond(res,403,{error:'Credencial inválida'});
    if(role==='viewer'&&(!peer||!/^v-[a-zA-Z0-9_-]{8,60}$/.test(peer)))return respond(res,400,{error:'Identificador inválido'});
    if(role==='viewer'&&!room.viewers.has(peer)&&room.viewers.size>=MAX_VIEWERS)return respond(res,429,{error:'Sala cheia'});
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': conectado\n\n');
    const conn={res,role,peer};room.lastActivity=Date.now();
    if(role==='host'){
      if(room.host&&room.host!==conn){send(room.host,{type:'replaced'});room.host.res.end();}
      room.host=conn;send(conn,{type:'ready',role,viewers:[...room.viewers.keys()],count:room.viewers.size,live:room.live});broadcast(room,{type:'host-online'});
    }else{
      const prev=room.viewers.get(peer);if(prev&&prev!==conn)prev.res.end();
      room.viewers.set(peer,conn);send(conn,{type:'ready',role,live:room.live,hostOnline:!!room.host,count:room.viewers.size,name:room.name});
      send(room.host,{type:'viewer-joined',peer});broadcast(room,{type:'count',count:room.viewers.size});
    }
    const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': ping\n\n');},15000);
    res.on('close',()=>{clearInterval(heartbeat);if(role==='host')disconnectHost(room,conn);else disconnectViewer(room,peer,conn);});
    return;
  }
  if(req.method==='POST'&&url.pathname==='/api/emit') {
    let body;try{body=await readBody(req);}catch{return respond(res,400,{error:'JSON inválido'});}
    const room=safeRoom(body.room);if(!room)return respond(res,404,{error:'Sala inexistente'});
    const role=body.role;const isHost=role==='host'&&body.key===room.key&&!!room.host;
    const isViewer=role==='viewer'&&typeof body.peer==='string'&&room.viewers.has(body.peer);
    if(!isHost&&!isViewer)return respond(res,403,{error:'Sem autorização'});
    room.lastActivity=Date.now();
    if(body.event==='heartbeat')return respond(res,200,{ok:true});
    if(body.event==='signal') {
      const msg=body.data;if(!msg||!['offer','answer','ice'].includes(msg.type))return respond(res,400,{error:'Sinal inválido'});
      if(JSON.stringify(msg).length>30000)return respond(res,413,{error:'Mensagem grande demais'});
      if(isHost){if(!room.viewers.has(body.to))return respond(res,404,{error:'Espectador não está na sala'});send(room.viewers.get(body.to),{type:'signal',from:'host',data:msg});}
      else send(room.host,{type:'signal',from:body.peer,data:msg});
      return respond(res,200,{ok:true});
    }
    if(body.event==='live'&&isHost){room.live=body.live===true;broadcast(room,{type:'live',live:room.live});return respond(res,200,{ok:true});}
    if(body.event==='chat') {
      const nickname=String(body.nickname||'Convidado').replace(/[<>]/g,'').trim().slice(0,22)||'Convidado';
      const message=String(body.message||'').replace(/[\u0000-\u001F]/g,'').trim().slice(0,400);
      if(!message)return respond(res,400,{error:'Mensagem vazia'});
      if(!room.messageTimes)room.messageTimes=new Map();const who=isHost?'host':body.peer;const now=Date.now();
      if(now-(room.messageTimes.get(who)||0)<650)return respond(res,429,{error:'Envie mais devagar'});room.messageTimes.set(who,now);
      broadcast(room,{type:'chat',id:crypto.randomBytes(6).toString('hex'),nickname,message,date:Date.now(),host:isHost});
      return respond(res,200,{ok:true});
    }
    return respond(res,400,{error:'Ação inválida'});
  }
  if(req.method!=='GET')return respond(res,405,{error:'Método não permitido'});
  if(url.pathname==='/favicon.ico')return serveFile(res,'favicon.svg');
  if(['/','/index.html'].includes(url.pathname)||/^\/(studio|watch)\/[a-zA-Z0-9_-]+$/.test(url.pathname))return serveFile(res,'index.html');
  const filename=decodeURIComponent(url.pathname.slice(1));
  if(['app.js','style.css','favicon.svg'].includes(filename))return serveFile(res,filename);
  return respond(res,404,{error:'Não encontrado'});
});
setInterval(()=>{for(const [id,room] of rooms){if(Date.now()-room.created>TTL_MS&&!room.host&&room.viewers.size===0)rooms.delete(id);}},60000).unref();
server.listen(PORT,HOST,()=>console.log(`\n NERI LIVE v2 em http://localhost:${PORT}\n Para espectadores remotos: hospede no Render HTTPS.\n`));
