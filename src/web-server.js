'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class WorkflowWebServer {
  constructor(store, options = {}) {
    this.store = store;
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 0;
    this.server = null;
    this.clients = new Set();
  }

  start() {
    if (this.server) return Promise.resolve(this.address());
    this.server = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', reject);
        resolve(this.address());
      });
    });
  }

  address() {
    const address = this.server?.address();
    return {
      host: this.host,
      port: typeof address === 'object' && address ? address.port : this.port,
      url: `http://${this.host}:${typeof address === 'object' && address ? address.port : this.port}`
    };
  }

  stop() {
    for (const client of this.clients) client.end();
    this.clients.clear();
    if (!this.server) return Promise.resolve();
    return new Promise(resolve => this.server.close(() => resolve()));
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/') return this.static(res, 'index.html');
      if (req.method === 'GET' && url.pathname === '/app.js') return this.static(res, 'app.js', 'application/javascript');
      if (req.method === 'GET' && url.pathname === '/styles.css') return this.static(res, 'styles.css', 'text/css');
      if (req.method === 'GET' && url.pathname === '/api/health') return this.json(res, { ok: true });

      const match = url.pathname.match(/^\/api\/workflows\/([^/]+)\/?$/);
      if (req.method === 'GET' && match) return this.json(res, this.store.read(match[1]));
      if (req.method === 'GET' && match && url.pathname.endsWith('/events')) return this.sse(req, res, match[1]);

      const annotationMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/annotations$/);
      if (req.method === 'GET' && annotationMatch) return this.json(res, this.store.readAnnotations(annotationMatch[1]));
      if (req.method === 'POST' && annotationMatch) {
        const body = await this.body(req);
        const annotation = this.store.addAnnotation(annotationMatch[1], body);
        this.broadcast(annotationMatch[1], { type: 'annotation.created', annotation });
        return this.json(res, annotation, 201);
      }

      const actionMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/decisions$/);
      if (req.method === 'POST' && actionMatch) {
        const body = await this.body(req);
        const decision = this.store.addDecision(actionMatch[1], body);
        this.broadcast(actionMatch[1], { type: 'human.decision', decision });
        return this.json(res, decision, 201);
      }

      if (req.method === 'GET' && url.pathname === '/events') return this.sse(req, res, url.searchParams.get('workflowId'));
      return this.json(res, { error: 'Not found' }, 404);
    } catch (error) {
      return this.json(res, { error: error.message, code: error.code || 'INTERNAL_ERROR' }, error.code === 'WORKFLOW_NOT_FOUND' ? 404 : 400);
    }
  }

  static(res, file, contentType = 'text/html; charset=utf-8') {
    const filePath = path.join(__dirname, '..', 'web', file);
    if (!fs.existsSync(filePath)) return this.json(res, { error: 'Web asset not found' }, 404);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(filePath));
  }

  json(res, value, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(value));
  }

  async body(req) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  }

  sse(req, res, workflowId) {
    if (!workflowId) return this.json(res, { error: 'workflowId is required' }, 400);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const client = { workflowId, res, id: randomUUID() };
    this.clients.add(client);
    res.write(`event: connected\ndata: ${JSON.stringify({ workflowId })}\n\n`);
    req.on('close', () => this.clients.delete(client));
  }

  broadcast(workflowId, event) {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) if (client.workflowId === workflowId) client.res.write(payload);
  }
}

module.exports = { WorkflowWebServer };
