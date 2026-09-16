const params = new URLSearchParams(location.search);
const workflowId = params.get('workflowId');
let state = null;
let annotations = [];
let documentText = '';
const stages = ['specify', 'design', 'tasks', 'implement', 'review'];
const $ = id => document.getElementById(id);
const stageLabel = s => ({ specify: 'Specify', design: 'Design', tasks: 'Tasks', implement: 'Implement', review: 'Review' })[s] || s;
const statusLabel = s => ({ pending: '待开始', ready: '待执行', running: 'Agent 执行中', waiting_approval: '等待人工确认', completed: '已完成', failed: '执行失败' })[s] || s;
const esc = value => String(value ?? '').replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));

async function loadData() {
  const [s, a, d] = await Promise.all([
    fetch(`/api/workflows/${encodeURIComponent(workflowId)}`).then(r => r.json()),
    fetch(`/api/workflows/${encodeURIComponent(workflowId)}/annotations`).then(r => r.json()),
    fetch(`/api/workflows/${encodeURIComponent(workflowId)}/document`).then(r => r.json())
  ]);
  state = s;
  annotations = a;
  documentText = d.content || '';
  render();
}

async function load() {
  if (!workflowId) { $('stage-title').textContent = '缺少 workflowId'; return; }
  await loadData();
  connect();
}

function render() {
  $('workflow-name').textContent = state.workflowId;
  $('timeline').innerHTML = stages.map((s, i) => {
    const st = state.stages[s], cls = st.status === 'completed' ? 'done' : s === state.currentStage ? 'current' : '';
    return `<div class="step ${cls}"><div class="dot">${st.status === 'completed' ? '✓' : i + 1}</div><div>${stageLabel(s)}</div></div>`;
  }).join('');
  $('stage-card').innerHTML = `<div class="stage current"><strong>${stageLabel(state.currentStage)}</strong><small>${statusLabel(state.stages[state.currentStage].status)}</small></div>`;
  $('stage-list').innerHTML = stages.map(s => {
    const st = state.stages[s];
    return `<div class="stage ${s === state.currentStage ? 'current' : ''} ${st.status === 'completed' ? 'done' : ''}">${st.status === 'completed' ? '✓ ' : ''}${stageLabel(s)}<small>${statusLabel(st.status)}</small></div>`;
  }).join('');
  $('stage-title').textContent = stageLabel(state.currentStage);
  $('stage-status').textContent = statusLabel(state.stages[state.currentStage].status);
  renderActions();
  renderDocument();
  renderAnnotations();
}

function renderActions() {
  const st = state.stages[state.currentStage];
  if (st.status === 'waiting_approval') {
    $('actions').innerHTML = `
      <button class="btn primary" onclick="decision('approve')">通过并进入下一阶段</button>
      <button class="btn comment-action" onclick="decision('apply-comments')">拉取 Docs 评论并重新修改</button>
      <button class="btn warning" onclick="revise()">直接修改文档</button>`;
  } else if (st.status === 'failed') {
    $('actions').innerHTML = '<button class="btn primary" onclick="decision(\'retry\')">重试</button>';
  } else {
    $('actions').innerHTML = '';
  }
}

function markdownInline(value) {
  let html = esc(value);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return html;
}

function lineHtml(line, startOffset, endOffset) {
  const ranges = annotations
    .filter(a => a.status === 'open' && a.stage === state.currentStage && Number.isInteger(a.target?.start) && Number.isInteger(a.target?.end))
    .map(a => ({ ...a, start: Math.max(startOffset, a.target.start), end: Math.min(endOffset, a.target.end) }))
    .filter(a => a.start < a.end)
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return markdownInline(line);
  let html = '', cursor = startOffset;
  for (const a of ranges) {
    if (a.start > cursor) html += markdownInline(documentText.slice(cursor, a.start));
    html += `<mark class="comment-underline" title="${esc(a.content)}">${markdownInline(documentText.slice(a.start, a.end))}</mark>`;
    cursor = Math.max(cursor, a.end);
  }
  if (cursor < endOffset) html += markdownInline(documentText.slice(cursor, endOffset));
  return html;
}

function renderMarkdown() {
  const lines = documentText.split('\n');
  let offset = 0;
  let inCode = false;
  const html = lines.map(line => {
    const start = offset;
    const end = start + line.length;
    offset = end + 1;
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      return `<div class="md-code-fence">${esc(line)}</div>`;
    }
    if (inCode) return `<div class="md-code-line">${lineHtml(line, start, end)}</div>`;
    if (!line.trim()) return '<div class="md-blank"></div>';
    const content = lineHtml(line, start, end);
    if (/^###\s+/.test(line)) return `<h4>${content.replace(/^###\s+/, '')}</h4>`;
    if (/^##\s+/.test(line)) return `<h3>${content.replace(/^##\s+/, '')}</h3>`;
    if (/^#\s+/.test(line)) return `<h2>${content.replace(/^#\s+/, '')}</h2>`;
    if (/^>\s?/.test(line)) return `<blockquote>${content.replace(/^&gt;\s?/, '')}</blockquote>`;
    if (/^[-*]\s+/.test(line)) return `<div class="md-list">• ${content.replace(/^[-*]\s+/, '')}</div>`;
    if (/^\d+\.\s+/.test(line)) return `<div class="md-list">${esc(line.match(/^\d+/)[0])}. ${content.replace(/^\d+\.\s+/, '')}</div>`;
    if (/^---+$/.test(line.trim())) return '<hr>';
    return `<p>${content}</p>`;
  }).join('');
  return html;
}

function renderDocument() {
  if (!documentText) {
    $('document').innerHTML = '<div class="empty">当前阶段尚未生成文档</div>';
    return;
  }
  const artifact = (state.stages[state.currentStage].artifact || '').split('/artifacts/')[1] || 'artifact';
  $('document').innerHTML = `
    <div class="doc-toolbar"><span class="badge">${esc(artifact)}</span><span class="hint">选中文字后点击「添加评论」，评论会以划线标记在文档中。</span></div>
    <div class="markdown" id="doc-text">${renderMarkdown()}</div>
    <div class="doc-tools"><button class="btn" onclick="addAnnotation()">＋ 添加评论</button></div>`;
}

function renderAnnotations() {
  $('annotations').innerHTML = annotations.length ? annotations.map(a => `
    <div class="annotation ${a.status === 'resolved' ? 'resolved' : ''}">
      <div class="annotation-head"><strong>${esc(a.type || 'comment')}</strong><small>${esc(a.status || 'open')}</small></div>
      <div>${esc(a.content || '')}</div>
      ${a.target?.quote ? `<div class="annotation-quote">“${esc(a.target.quote)}”</div>` : ''}
    </div>`).join('') : '<div class="empty">还没有评论。</div>';
}

function renderActivity() {
  $('activity').innerHTML = `<div class="empty">当前阶段：${stageLabel(state.currentStage)} · ${statusLabel(state.stages[state.currentStage].status)}</div>`;
}

function connect() {
  const es = new EventSource(`/events?workflowId=${encodeURIComponent(workflowId)}`);
  es.onopen = () => { $('connection').textContent = '● Connected'; $('connection').className = 'status ok'; };
  es.onerror = () => { $('connection').textContent = '● Reconnecting'; $('connection').className = 'status waiting'; };
  es.addEventListener('annotation.created', e => { annotations.push(JSON.parse(e.data).annotation); renderDocument(); renderAnnotations(); });
  es.addEventListener('workflow.updated', async e => {
    state = JSON.parse(e.data).state;
    const [a, d] = await Promise.all([
      fetch(`/api/workflows/${encodeURIComponent(workflowId)}/annotations`).then(r => r.json()),
      fetch(`/api/workflows/${encodeURIComponent(workflowId)}/document`).then(r => r.json())
    ]);
    annotations = a;
    documentText = d.content || '';
    render();
  });
}

async function addAnnotation() {
  const sel = window.getSelection();
  const quote = sel?.toString() || '';
  if (!quote.trim()) { alert('请先在 Markdown 预览中选择需要评论的文字。'); return; }
  const content = prompt(`为选中的内容添加评论：\n\n“${quote}”`);
  if (!content) return;
  const type = prompt('评论类型（requirement / question / change / custom）：', 'change') || 'custom';
  const start = documentText.indexOf(quote);
  if (start < 0) { alert('无法定位选中的文档内容，请重新选择。'); return; }
  await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/annotations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, content, stage: state.currentStage, target: { quote, start, end: start + quote.length } })
  });
  sel.removeAllRanges();
}

async function decision(action) {
  await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/decisions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, stage: state.currentStage })
  });
}

async function revise() {
  const feedback = prompt('请输入修改意见：');
  if (feedback) decision(`revise:${feedback}`);
}

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'));
  b.classList.add('active');
  $(b.dataset.tab).classList.remove('hidden');
  if (b.dataset.tab === 'activity') renderActivity();
});
load();
