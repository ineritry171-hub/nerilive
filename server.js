'use strict';
// NERI LIVE DUO — sala privada para duas transmissões de tela simultâneas.
// O servidor só encaminha sinais WebRTC e mensagens; não recebe vídeo.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 4747);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const MAX_PEERS = 2;
const EXPIRY_MS = 12 * 60 * 60 * 1000;
const GRACE_MS = 20000;
const rooms = new Map();
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const defaultIce = [{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}];
let iceServers = defaultIce;
try {const value=JSON.parse(process.env.ICE_SERVERS_JSON || JSON.stringify(defaultIce)); if(Array.isArray(value))iceServers=value;}catch{}

function json(res,code,data) {
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
function readJSON(req) {return new Promise((resolve,reject)=>{
  let s='';req.on('data',chunk=>{s+=chunk;if(s.length>100000){reject(new Error('Payload muito grande'));req.destroy();}});
  req.on('end',()=>{try{resolve(JSON.parse(s||'{}'));}catch{reject(new Error('JSON inválido'));}});req.on('error',reject);
});}
function getRoom(id) {return typeof id==='string' && /^priv-[a-f0-9]{14}$/.test(id) ? rooms.get(id):null;}
function send(member,evt) {if(!member?.sse||member.sse.res.destroyed)return;try{member.sse.res.write(`data: ${JSON.stringify(evt)}\n\n`);}catch{}}
function emitAll(room,evt,except) {for(const m of room.members.values())if(m.id!==except)send(m,evt);}
function online(room){return [...room.members.values()].filter(m=>!!m.sse).length;}
function roomData(room){return {id:room.id,name:room.name,online:online(room),capacity:MAX_PEERS,live:[...room.members.values()].filter(m=>m.sse&&m.live).length};}
function dropMember(room,member) {
  if(room.members.get(member.id)!==member)return;
  if(member.sse){const old=member.sse;member.sse=null;try{old.res.end();}catch{}}
  room.members.delete(member.id);
  emitAll(room,{type:'peer-left',peer:member.id});emitAll(room,{type:'presence',...roomData(room)});
}
function cleanRoom(room) {const now=Date.now();for(const member of [...room.members.values()])if(!member.sse&&now-member.lastSeen>GRACE_MS)dropMember(room,member);}
function credentials(room,body){
  if(typeof body?.peer!=='string'||typeof body?.token!=='string')return null;
  const member=room.members.get(body.peer);
  if(!member||member.token!==body.token)return null;
  return member;
}
function serve(res,name){const file=path.join(PUBLIC,name);if(!file.startsWith(PUBLIC+path.sep))return json(res,403,{error:'Acesso negado'});
  fs.readFile(file,(err,bytes)=>{if(err)return json(res,404,{error:'Não encontrado'});res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(bytes);});}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{status:'ok',app:'NERI LIVE DUO',version:'3.0.0'});
  if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,{iceServers,capacity:MAX_PEERS});
  if(req.method==='POST'&&url.pathname==='/api/rooms'){
    let body;try{body=await readJSON(req);}catch{return json(res,400,{error:'JSON inválido'});}
    const name=String(body.name||'Sala de amigos').replace(/[<>]/g,'').trim().slice(0,54)||'Sala de amigos';
    const id='priv-'+crypto.randomBytes(7).toString('hex');
    const room={id,name,members:new Map(),created:Date.now()};rooms.set(id,room);
    return json(res,201,{id,url:`/room/${id}`});
  }
  const roomMatch=url.pathname.match(/^\/api\/rooms\/(priv-[a-f0-9]{14})(?:\/(join))?$/);
  if(roomMatch){const room=getRoom(roomMatch[1]);if(!room)return json(res,404,{error:'Sala não encontrada ou expirada'});
    if(req.method==='GET'&&!roomMatch[2])return json(res,200,roomData(room));
    if(req.method==='POST'&&roomMatch[2]==='join'){
      let data;try{data=await readJSON(req);}catch{return json(res,400,{error:'JSON inválido'});}
      cleanRoom(room);
      // Reconexão autenticada, sem permitir que outra pessoa roube a mesma sessão.
      const existing=credentials(room,data);
      if(existing){existing.lastSeen=Date.now();return json(res,200,{peer:existing.id,token:existing.token,name:room.name,room:room.id});}
      if(room.members.size>=MAX_PEERS)return json(res,409,{error:'Sala cheia: máximo de 2 pessoas.'});
      const member={id:'p-'+crypto.randomBytes(9).toString('hex'),token:crypto.randomBytes(24).toString('base64url'),live:false,sse:null,lastSeen:Date.now(),name:'Convidado'};
      room.members.set(member.id,member);
      return json(res,200,{peer:member.id,token:member.token,name:room.name,room:room.id});
    }
  }
  if(req.method==='GET'&&url.pathname==='/api/events'){
    const room=getRoom(url.searchParams.get('room'));
    if(!room)return json(res,404,{error:'Sala não encontrada'});
    const member=credentials(room,{peer:url.searchParams.get('peer'),token:url.searchParams.get('token')});
    if(!member)return json(res,403,{error:'Acesso negado'});
    if(member.sse){try{member.sse.res.end();}catch{}}
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': conectado\n\n');
    const conn={res};member.sse=conn;member.lastSeen=Date.now();
    send(member,{type:'ready',room:roomData(room),peers:[...room.members.values()].filter(p=>p.id!==member.id&&p.sse).map(p=>({id:p.id,live:p.live}))});
    emitAll(room,{type:'peer-joined',peer:member.id,live:member.live},member.id);
    emitAll(room,{type:'presence',...roomData(room)});
    const ping=setInterval(()=>{if(!res.destroyed)res.write(': ping\n\n');},15000);
    res.on('close',()=>{clearInterval(ping);if(member.sse!==conn)return;member.sse=null;member.live=false;member.lastSeen=Date.now();emitAll(room,{type:'peer-left',peer:member.id});emitAll(room,{type:'presence',...roomData(room)});});
    return;
  }
  if(req.method==='POST'&&url.pathname==='/api/emit'){
    let body;try{body=await readJSON(req);}catch{return json(res,400,{error:'JSON inválido'});}
    const room=getRoom(body.room);if(!room)return json(res,404,{error:'Sala inexistente'});
    const member=credentials(room,body);if(!member||!member.sse)return json(res,403,{error:'Não conectado'});
    member.lastSeen=Date.now();
    if(body.event==='heartbeat')return json(res,200,{ok:true});
    if(body.event==='signal'){
      const dest=room.members.get(body.to);
      if(!dest?.sse||dest.id===member.id)return json(res,404,{error:'Participante indisponível'});
      const data=body.data;
      if(!data||!['offer','answer','ice'].includes(data.type)||JSON.stringify(data).length>70000)return json(res,400,{error:'Sinal inválido'});
      send(dest,{type:'signal',from:member.id,data});return json(res,200,{ok:true});
    }
    if(body.event==='live'){
      member.live=body.live===true;
      emitAll(room,{type:'peer-live',peer:member.id,live:member.live});emitAll(room,{type:'presence',...roomData(room)});
      return json(res,200,{ok:true});
    }
    if(body.event==='chat'){
      const now=Date.now();if(now-(member.lastChat||0)<650)return json(res,429,{error:'Envie mais devagar'});
      const message=String(body.message||'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,400);
      if(!message)return json(res,400,{error:'Mensagem vazia'});
      member.lastChat=now;
      const nickname=String(body.nickname||'Convidado').replace(/[<>]/g,'').trim().slice(0,22)||'Convidado';
      emitAll(room,{type:'chat',nickname,message,date:now,from:member.id});return json(res,200,{ok:true});
    }
    return json(res,400,{error:'Ação inválida'});
  }
  if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
  if(url.pathname==='/favicon.ico')return serve(res,'favicon.svg');
  if(url.pathname==='/'||url.pathname==='/index.html'||/^\/(room|watch|studio)\/priv-[a-f0-9]{14}$/.test(url.pathname))return serve(res,'index.html');
  const filename=decodeURIComponent(url.pathname.slice(1));
  if(['app.js','style.css','favicon.svg'].includes(filename))return serve(res,filename);
  return json(res,404,{error:'Não encontrado'});
});
setInterval(()=>{for(const [id,room]of rooms){cleanRoom(room);if(Date.now()-room.created>EXPIRY_MS&&room.members.size===0)rooms.delete(id);}},10000).unref();
server.listen(PORT,HOST,()=>console.log(`NERI LIVE DUO v3 em http://localhost:${PORT}`));
