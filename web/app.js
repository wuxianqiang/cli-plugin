const params = new URLSearchParams(location.search);
const workflowId = params.get('workflowId');
let state = null;
let annotations = [];
const stages = ['specify','design','tasks','implement','review'];

const $ = id => document.getElementById(id);
function escapeHtml(value=''){return String(value).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));}
function stageLabel(s){return ({specify:'Specify',design:'Design',tasks:'Tasks',implement:'Implement',review:'Review'})[s]||s;}
function statusLabel(s){return ({pending:'待开始',ready:'待执行',running:'Agent 执行中',waiting_approval:'等待人工确认',completed:'已完成',failed:'执行失败'})[s]||s;}

async function load(){
  if(!workflowId){ $('stage-title').textContent='缺少 workflowId'; return; }
  const [s,a] = await Promise.all([fetch(`/api/workflows/${encodeURIComponent(workflowId)}`).then(r=>r.json()),fetch(`/api/workflows/${encodeURIComponent(workflowId)}/annotations`).then(r=>r.json())]);
  state=s; annotations=a; render();
  connect();
}
function render(){
  $('workflow-name').textContent=state.workflowId;
  $('timeline').innerHTML=stages.map((s,i)=>{const st=state.stages[s];const cls=st.status==='completed'?'done':s===state.currentStage?'current':'';return `<div class="step ${cls}"><div class="dot">${st.status==='completed'?'✓':i+1}</div><div>${stageLabel(s)}</div></div>`}).join('');
  $('stage-card').innerHTML=`<div class="stage current"><strong>${stageLabel(state.currentStage)}</strong><small>${statusLabel(state.stages[state.currentStage].status)}</small></div>`;
  $('stage-list').innerHTML=stages.map(s=>{const st=state.stages[s];return `<div class="stage ${s===state.currentStage?'current':''} ${st.status==='completed'?'done':''}">${st.status==='completed'?'✓ ':''}${stageLabel(s)}<small>${statusLabel(st.status)}</small></div>`}).join('');
  $('stage-title').textContent=stageLabel(state.currentStage);
  $('stage-status').textContent=statusLabel(state.stages[state.currentStage].status);
  renderActions(); renderDocument(); renderAnnotations();
}
function renderActions(){
  const st=state.stages[state.currentStage]; let html='';
  if(st.status==='waiting_approval') html=`<button class="btn primary" onclick="decision('approve')">通过并进入下一阶段</button><button class="btn warning" onclick="revise()">修改文档</button>`;
  else if(st.status==='failed') html=`<button class="btn primary" onclick="decision('retry')">重试</button>`;
  $('actions').innerHTML=html;
}
function renderDocument(){
  const artifact=state.stages[state.currentStage].artifact;
  if(!artifact){$('document').innerHTML='<div class="empty">当前阶段尚未生成文档</div>';return;}
  const relative=artifact.split('/artifacts/')[1]||artifact;
  $('document').innerHTML=`<div><span class="badge">${escapeHtml(relative)}</span></div><pre class="markdown" id="doc-text">文档由 Agent 生成后显示在这里。当前 CLI 状态已连接。</pre><div style="margin-top:18px"><button class="btn" onclick="addAnnotation()">＋ 添加自定义标记</button></div>`;
}
function renderAnnotations(){
  $('annotations').innerHTML=annotations.length?annotations.map(a=>`<div class="annotation"><strong>${escapeHtml(a.type||'comment')}</strong><div>${escapeHtml(a.content||'')}</div><small>${escapeHtml(a.status||'open')}</small></div>`).join(''):'<div class="empty">还没有标记。阅读文档后可以添加自定义反馈。</div>';
}
function renderActivity(){ $('activity').innerHTML=`<div class="empty">当前阶段：${stageLabel(state.currentStage)} · ${statusLabel(state.stages[state.currentStage].status)}</div>`; }
function connect(){
  const es=new EventSource(`/events?workflowId=${encodeURIComponent(workflowId)}`);
  es.onopen=()=>{$('connection').textContent='● Connected';$('connection').className='status ok';};
  es.onerror=()=>{$('connection').textContent='● Reconnecting';$('connection').className='status waiting';};
  es.addEventListener('annotation.created',e=>{annotations.push(JSON.parse(e.data).annotation);renderAnnotations();});
  es.addEventListener('human.decision',()=>load());
}
async function addAnnotation(){
  const content=prompt('请输入需要 Agent 处理的标记：'); if(!content)return;
  const type=prompt('标记类型（requirement / question / change / custom）：','custom')||'custom';
  await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/annotations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,content,stage:state.currentStage})});
}
async function decision(action){await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/decisions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,stage:state.currentStage})});}
async function revise(){const feedback=prompt('请输入修改意见：');if(feedback)await decision('revise:'+feedback);}
document.querySelectorAll('.tabs button').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));document.querySelectorAll('.panel').forEach(p=>p.classList.add('hidden'));btn.classList.add('active');$(btn.dataset.tab).classList.remove('hidden');if(btn.dataset.tab==='activity')renderActivity();});
load();
