'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class WorkflowWebServer {
  constructor(store, engine, options = {}) { this.store=store; this.engine=engine; this.host=options.host||'127.0.0.1'; this.port=options.port||0; this.server=null; this.clients=new Set(); }
  start(){ if(this.server)return Promise.resolve(this.address()); this.server=http.createServer((req,res)=>this.handle(req,res)); return new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,this.host,()=>{this.server.removeListener('error',reject);resolve(this.address());});}); }
  address(){const a=this.server?.address();const port=typeof a==='object'&&a?a.port:this.port;return{host:this.host,port,url:`http://${this.host}:${port}`};}
  stop(){for(const c of this.clients)c.res.end();this.clients.clear();if(!this.server)return Promise.resolve();return new Promise(r=>this.server.close(()=>r()));}
  async handle(req,res){try{const url=new URL(req.url,`http://${req.headers.host}`);
    if(req.method==='GET'&&url.pathname==='/')return this.static(res,'index.html');
    if(req.method==='GET'&&url.pathname==='/app.js')return this.static(res,'app.js','application/javascript');
    if(req.method==='GET'&&url.pathname==='/styles.css')return this.static(res,'styles.css','text/css');
    if(req.method==='GET'&&url.pathname==='/api/health')return this.json(res,{ok:true});
    let m=url.pathname.match(/^\/api\/workflows\/([^/]+)$/); if(req.method==='GET'&&m)return this.json(res,this.store.read(m[1]));
    m=url.pathname.match(/^\/api\/workflows\/([^/]+)\/document$/); if(req.method==='GET'&&m)return this.document(res,m[1]);
    m=url.pathname.match(/^\/api\/workflows\/([^/]+)\/annotations$/); if(req.method==='GET'&&m)return this.json(res,this.store.readAnnotations(m[1]));
    if(req.method==='POST'&&m){const body=await this.body(req);const annotation=this.store.addAnnotation(m[1],body);this.broadcast(m[1],{type:'annotation.created',annotation});return this.json(res,annotation,201);}
    m=url.pathname.match(/^\/api\/workflows\/([^/]+)\/decisions$/); if(req.method==='POST'&&m){const id=m[1],body=await this.body(req);const decision=this.store.addDecision(id,body);const action=body.action||'';if(action==='approve'||action==='retry')this.engine.change({id},action);else if(action.startsWith('revise:'))this.engine.change({id,feedback:action.slice(7)},'revise',{feedback:action.slice(7)});this.broadcast(id,{type:'human.decision',decision});this.broadcast(id,{type:'workflow.updated',state:this.store.read(id)});return this.json(res,decision,201);}
    if(req.method==='GET'&&url.pathname==='/events')return this.sse(req,res,url.searchParams.get('workflowId'));
    return this.json(res,{error:'Not found'},404);
  }catch(e){return this.json(res,{error:e.message,code:e.code||'INTERNAL_ERROR'},e.code==='WORKFLOW_NOT_FOUND'?404:400);}}
  document(res,id){const state=this.store.read(id);const artifact=state.stages[state.currentStage].artifact;if(!artifact)return this.json(res,{content:'',artifact:null});const root=path.resolve(this.store.root,'.dev','workflows',id);const file=path.resolve(this.store.root,artifact);if(!file.startsWith(root+path.sep))return this.json(res,{error:'Invalid artifact path'},400);return this.json(res,{content:fs.existsSync(file)?fs.readFileSync(file,'utf8'):'',artifact});}
  static(res,file,type='text/html; charset=utf-8'){const p=path.join(__dirname,'..','web',file);if(!fs.existsSync(p))return this.json(res,{error:'Web asset not found'},404);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});res.end(fs.readFileSync(p));}
  json(res,v,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(v));}
  async body(req){let raw='';for await(const c of req)raw+=c;return raw?JSON.parse(raw):{};}
  sse(req,res,id){if(!id)return this.json(res,{error:'workflowId is required'},400);res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache',Connection:'keep-alive','Access-Control-Allow-Origin':'*'});const c={workflowId:id,res,id:randomUUID()};this.clients.add(c);res.write(`event: connected\ndata: ${JSON.stringify({workflowId:id})}\n\n`);req.on('close',()=>this.clients.delete(c));}
  broadcast(id,event){const payload=`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;for(const c of this.clients)if(c.workflowId===id)c.res.write(payload);}
}
module.exports={WorkflowWebServer};
