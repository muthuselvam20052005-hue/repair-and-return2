'use strict';
/* Repair & Return - backend + web server. No npm packages needed, only Node.js 16+.
   Run:  node server.js        Customer app:  http://localhost:3000        Organization website:  http://localhost:3000/org */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ORG_PASSWORD = process.env.ORG_PASSWORD || 'repair123';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');

const PRODUCTS = { headphones: 0.3, charger: 0.15, earphones: 0.05, speaker: 0.6, other: 0.3 };
const PROBLEMS = ['Not switching on', 'Not charging', 'No sound', 'Broken wire', 'Physical damage', 'Other'];
const SLOTS = ['9:00 AM–12:00 PM', '12:00–3:00 PM', '5:00–7:00 PM'];
const DAYS = ['Today', 'Tomorrow'];
const PICKERS = ['Murugan', 'Selvi', 'Rajesh'];
const PARTNERS = ['Kumar Electronics', 'Arul Repair Hub', 'Fix-It Corner'];
const BASE = { repaired: 48, reused: 32, recycled: 8, kg: 12.5 };

/* ---------- data (saved to data.json) ---------- */
let db = { reqs: [], nextId: 1001 };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* first run */ }
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DATA_FILE); }
    catch (e) { console.error('Could not save data:', e.message); }
  }, 100);
}

/* ---------- live updates (Server-Sent Events) ---------- */
const clients = new Set();
function broadcast() { clients.forEach(c => { try { c.write('data: change\n\n'); } catch (e) { clients.delete(c); } }); }
setInterval(() => clients.forEach(c => { try { c.write(': ping\n\n'); } catch (e) { clients.delete(c); } }), 20000);

/* ---------- helpers ---------- */
const tokens = new Set();
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-org-token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
function send(res, status, obj) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS));
  res.end(JSON.stringify(obj));
}
function fail(status, message) { return Object.assign(new Error(message), { status }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 1.5e6) { reject(fail(413, 'Request too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(fail(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}
const isOrg = req => tokens.has(req.headers['x-org-token']);
function stats() {
  let r = BASE.repaired, u = BASE.reused, c = BASE.recycled, w = BASE.kg, live = 0;
  db.reqs.forEach(q => {
    if (q.stage !== 4) return;
    live++;
    if (q.outcome === 'recycled') c++; else { w += PRODUCTS[q.product] || 0; q.outcome === 'reused' ? u++ : r++; }
  });
  return { repaired: r, reused: u, recycled: c, kg: Math.round(w * 100) / 100, live, saved: r + u };
}
function createRequest(b) {
  const name = String(b.name || '').trim().slice(0, 40);
  const mobile = String(b.mobile || '').replace(/\D/g, '');
  const details = String(b.details || '').trim().slice(0, 500);
  const address = String(b.address || '').trim().slice(0, 200);
  if (name.length < 2) throw fail(400, 'Enter your name.');
  if (!/^[6-9]\d{9}$/.test(mobile)) throw fail(400, 'Enter a valid 10-digit mobile number.');
  if (!(b.product in PRODUCTS)) throw fail(400, 'Choose a product.');
  if (!PROBLEMS.includes(b.problem)) throw fail(400, 'Choose the problem.');
  if (b.problem === 'Other' && !details) throw fail(400, 'Describe the problem.');
  if (!address) throw fail(400, 'Enter the pickup address.');
  if (!DAYS.includes(b.day) || !SLOTS.includes(b.slot)) throw fail(400, 'Choose a pickup time.');
  const photo = (typeof b.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo) && b.photo.length <= 700000) ? b.photo : null;
  const iso = new Date().toISOString();
  const q = { id: 'RR-' + new Date().getFullYear() + '-' + (db.nextId++), customer: name, mobile, product: b.product, problem: b.problem, details, photo,
    address, day: b.day, slot: b.slot, stage: 0, outcome: null, pickupBy: null, partner: null, log: [iso, null, null, null, null], created: iso };
  db.reqs.push(q);
  return q;
}
function applyAction(q, action, value) {
  const t = new Date().toISOString();
  const need = s => { if (q.stage !== s) throw fail(409, 'This request was already updated. Refreshing.'); };
  switch (action) {
    case 'assign': need(0); if (!PICKERS.includes(value)) throw fail(400, 'Choose a pickup person.'); q.pickupBy = value; q.stage = 1; q.log[1] = t; break;
    case 'pickup': need(1); if (!PARTNERS.includes(value)) throw fail(400, 'Choose a repair partner.'); q.partner = value; q.stage = 2; q.log[2] = t; break;
    case 'repaired': need(2); q.outcome = 'repaired'; q.stage = 3; q.log[3] = t; break;
    case 'reuse': need(2); q.outcome = 'reused'; q.stage = 4; q.log[3] = q.log[4] = t; break;
    case 'recycle': need(2); q.outcome = 'recycled'; q.stage = 4; q.log[3] = q.log[4] = t; break;
    case 'return': need(3); q.stage = 4; q.log[4] = t; break;
    default: throw fail(400, 'Unknown action.');
  }
}

/* ---------- server ---------- */
const PAGES = { '/': 'customer.html', '/customer': 'customer.html', '/org': 'organization.html', '/organization': 'organization.html' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    if (req.method === 'GET' && PAGES[p]) {
      const html = fs.readFileSync(path.join(PUBLIC, PAGES[p]));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }, CORS));
      res.write('retry: 2000\n\n'); clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'GET' && p === '/api/stats') return send(res, 200, stats());

    if (req.method === 'POST' && p === '/api/org/login') {
      const b = await readBody(req);
      const a = Buffer.from(String(b.password || '')), z = Buffer.from(ORG_PASSWORD);
      if (a.length !== z.length || !crypto.timingSafeEqual(a, z)) throw fail(401, 'Wrong password.');
      const token = crypto.randomBytes(16).toString('hex'); tokens.add(token);
      return send(res, 200, { token });
    }
    if (req.method === 'GET' && p === '/api/requests') {
      if (isOrg(req)) return send(res, 200, db.reqs);
      const mobile = String(url.searchParams.get('mobile') || '').replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(mobile)) throw fail(400, 'Mobile number required.');
      return send(res, 200, db.reqs.filter(q => q.mobile === mobile));
    }
    if (req.method === 'POST' && p === '/api/requests') {
      const q = createRequest(await readBody(req));
      persist(); broadcast();
      return send(res, 201, q);
    }
    const m = p.match(/^\/api\/requests\/([A-Za-z0-9-]+)\/action$/);
    if (req.method === 'POST' && m) {
      if (!isOrg(req)) throw fail(401, 'Please sign in.');
      const q = db.reqs.find(x => x.id === m[1]);
      if (!q) throw fail(404, 'Request not found.');
      const b = await readBody(req);
      applyAction(q, b.action, b.value);
      persist(); broadcast();
      return send(res, 200, q);
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nRepair & Return is running.\n');
  console.log('  Customer app          http://localhost:' + PORT + '/');
  console.log('  Organization website  http://localhost:' + PORT + '/org   (password: ' + (process.env.ORG_PASSWORD ? '[from ORG_PASSWORD]' : ORG_PASSWORD) + ')');
  const ips = [];
  Object.values(os.networkInterfaces()).forEach(l => (l || []).forEach(i => { if (i.family === 'IPv4' && !i.internal) ips.push(i.address); }));
  ips.forEach(ip => console.log('\n  On your phone (same Wi-Fi):  http://' + ip + ':' + PORT + '/'));
  console.log('\nPress Ctrl+C to stop.\n');
});
module.exports = server;
