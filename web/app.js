const params = new URLSearchParams(location.search);
const workflowId = params.get('workflowId');
let state = null;
let annotations = [];
let documentText = '';
const stages = ['specify', 'design', 'tasks', 'implement', 'review'];
const $ = id => document.getElementById(id);
const stageLabel = s => ({ specify: 'Specify', design: 'Design', tasks: 'Tasks', implement: 'Implement', review: 'Review' })[s] || s;
const statusLabel = s => ({ pending: '待开始', ready: '待执行', running: 'Agent 执行中', waiting_approval: '等待 CLI 确认', completed: '已完成', failed: '执行失败' })[s] || s;
const esc = value => String(value ?? '').replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));
let pendingSelection = null;

async function loadData() {
  const [s, a, d] = await Promise.all([
    fetch(`/api/workflows/${encodeURIComponent(workflowId)}`).then(r => r.json()),
    fetch(`/api/workflows/${encodeURIComponent(workflowId)}/annotations`).then(r => r.json()),
    fetch(`/api/workflows/${encodeURIComponent(workflowId)}/document`).then(r => r.json())
  ]);
  if (s.error) throw new Error(s.error);
  if (d.error) throw new Error(d.error);
  state = s;
  annotations = Array.isArray(a) ? a : [];
  documentText = d.content || '';
  render();
}

async function load() {
  if (!workflowId) { $('stage-title').textContent = '缺少 workflowId'; return; }
  try {
    await loadData();
    connect();
  } catch (error) {
    $('stage-title').textContent = '文档加载失败';
    $('stage-status').textContent = error.message;
    $('document').innerHTML = `<div class="empty">无法加载当前阶段 Markdown：${esc(error.message)}</div>`;
    console.error(error);
  }
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
  renderDocument();
  renderAnnotations();
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

function annotationRanges(startOffset, endOffset) {
  return annotations
    .filter(a => a.status === 'open' && a.stage === state.currentStage && Number.isInteger(a.target?.start) && Number.isInteger(a.target?.end))
    .map(a => ({ ...a, start: Math.max(startOffset, a.target.start), end: Math.min(endOffset, a.target.end) }))
    .filter(a => a.start < a.end)
    .sort((a, b) => a.start - b.start);
}

function lineHtml(line, startOffset, endOffset) {
  const ranges = annotationRanges(startOffset, endOffset);
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
  const output = [];

  for (const line of lines) {
    const start = offset;
    const end = start + line.length;
    offset = end + 1;

    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      output.push(`<div class="md-code-fence">${esc(line)}</div>`);
      continue;
    }
    if (inCode) {
      output.push(`<div class="md-code-line">${lineHtml(line, start, end)}</div>`);
      continue;
    }
    if (!line.trim()) {
      output.push('<div class="md-blank"></div>');
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      const prefixLength = heading[1].length + 1;
      const content = lineHtml(line.slice(prefixLength), start + prefixLength, end);
      output.push(`<h${level}>${content}</h${level}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const prefixLength = line.match(/^>\s?/)[0].length;
      output.push(`<blockquote>${lineHtml(line.slice(prefixLength), start + prefixLength, end)}</blockquote>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const prefixLength = line.match(/^[-*]\s+/)[0].length;
      output.push(`<div class="md-list">• ${lineHtml(line.slice(prefixLength), start + prefixLength, end)}</div>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const match = line.match(/^(\d+)\.\s+/);
      const prefixLength = match[0].length;
      output.push(`<div class="md-list">${match[1]}. ${lineHtml(line.slice(prefixLength), start + prefixLength, end)}</div>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      output.push('<hr>');
      continue;
    }
    output.push(`<p>${lineHtml(line, start, end)}</p>`);
  }

  return output.join('');
}

function renderDocument() {
  if (!documentText) {
    $('document').innerHTML = '<div class="empty">当前阶段尚未生成 Markdown 文档</div>';
    return;
  }
  const artifact = (state.stages[state.currentStage].artifact || '').split('/artifacts/')[1] || 'artifact';
  let markdownHtml;
  try {
    markdownHtml = renderMarkdown();
  } catch (error) {
    console.error('Markdown render failed', error);
    markdownHtml = `<pre class="markdown-fallback">${esc(documentText)}</pre>`;
  }
  $('document').innerHTML = `
    <div class="doc-toolbar"><span class="badge">${esc(artifact)}</span><span class="hint">选中文字后会出现「添加评论」按钮，流程推进和修改决策请在 CLI / Claude 对话中完成。</span></div>
    <div class="markdown" id="doc-text">${markdownHtml}</div>`;
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
  $('activity').innerHTML = `<div class="empty">当前阶段：${stageLabel(state.currentStage)} · ${statusLabel(state.stages[state.currentStage].status)}<br>网页仅用于 Docs 阅读与评论，流程控制由 CLI / Claude 对话负责。</div>`;
}

function getSelectionInDocument() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const doc = $('doc-text');
  if (!doc || !doc.contains(range.commonAncestorContainer)) return null;
  const quote = selection.toString();
  if (!quote.trim()) return null;
  return { selection, range, quote };
}

function getTextOffset(root, node, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current;
  while ((current = walker.nextNode())) {
    if (current === node) return total + offset;
    total += current.nodeValue.length;
  }
  return total;
}

function showCommentAction() {
  const selected = getSelectionInDocument();
  const action = $('selection-comment-action');
  if (!selected || !action) {
    if (action) action.classList.remove('visible');
    pendingSelection = null;
    return;
  }

  const root = $('doc-text');
  const rect = selected.range.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const start = getTextOffset(root, selected.range.startContainer, selected.range.startOffset);
  const end = getTextOffset(root, selected.range.endContainer, selected.range.endOffset);
  pendingSelection = { quote: selected.quote, start, end };

  action.style.left = `${Math.max(8, rect.left - rootRect.left + rect.width / 2 - 55)}px`;
  action.style.top = `${Math.max(8, rect.top - rootRect.top - 42)}px`;
  action.classList.add('visible');
}

function hideCommentAction() {
  const action = $('selection-comment-action');
  if (action) action.classList.remove('visible');
  pendingSelection = null;
}

async function addAnnotationFromSelection() {
  if (!pendingSelection) return;
  const { quote, start, end } = pendingSelection;
  const content = prompt(`为选中的内容添加评论：\n\n“${quote}”`);
  if (!content) return;
  const type = prompt('评论类型（requirement / question / change / custom）：', 'change') || 'custom';
  const response = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/annotations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, content, stage: state.currentStage, target: { quote, start, end } })
  });
  if (!response.ok) { alert('评论保存失败，请重试。'); return; }
  window.getSelection()?.removeAllRanges();
  hideCommentAction();
}

function connect() {
  const es = new EventSource(`/events?workflowId=${encodeURIComponent(workflowId)}`);
  es.onopen = () => { $('connection').textContent = '● Connected'; $('connection').className = 'status ok'; };
  es.onerror = () => { $('connection').textContent = '● Reconnecting'; $('connection').className = 'status waiting'; };
  es.addEventListener('annotation.created', e => {
    const annotation = JSON.parse(e.data).annotation;
    annotations.push(annotation);
    renderDocument();
    renderAnnotations();
  });
}

document.addEventListener('selectionchange', () => {
  window.clearTimeout(window.__selectionTimer);
  window.__selectionTimer = window.setTimeout(showCommentAction, 20);
});
document.addEventListener('mousedown', event => {
  const action = $('selection-comment-action');
  if (action && !action.contains(event.target)) hideCommentAction();
});
document.addEventListener('scroll', hideCommentAction, true);

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'));
  b.classList.add('active');
  $(b.dataset.tab).classList.remove('hidden');
  if (b.dataset.tab === 'activity') renderActivity();
});

load();