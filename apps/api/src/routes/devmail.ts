/**
 * Dev-mail viewer: browse the .eml files written by MAIL_TRANSPORT=maildir.
 * Admin-only. Returns 404 unless the server runs in maildir mode.
 *
 * - GET /api/v1/admin/dev-mail/messages      → JSON list (newest first)
 * - GET /api/v1/admin/dev-mail/messages/:id  → JSON parsed message
 * - GET /api/v1/admin/dev-mail/view          → HTML viewer (self-contained)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { sendError } from '../errors.js';
import { parseEml } from './devmail-parse.js';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.eml$/;

interface MessageMeta {
  id: string;
  to: string;
  subject: string;
  date: string;
  size: number;
}

async function maildirAvailable(): Promise<boolean> {
  if (config.mailTransport !== 'maildir') return false;
  try {
    const s = await stat(config.maildirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function listMessages(): Promise<MessageMeta[]> {
  const files = (await readdir(config.maildirPath)).filter((f) => ID_RE.test(f));
  const metas: (MessageMeta & { mtime: number })[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(path.join(config.maildirPath, f), 'utf8');
      const parsed = parseEml(raw);
      const st = await stat(path.join(config.maildirPath, f));
      metas.push({ id: f, to: parsed.to, subject: parsed.subject, date: parsed.date, size: st.size, mtime: st.mtimeMs });
    } catch {
      // skip unreadable files
    }
  }
  metas.sort((a, b) => b.mtime - a.mtime);
  return metas.map(({ mtime: _m, ...m }) => m);
}

const VIEWER_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev mail — BrandForge</title>
<style>
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#F7F3EA;color:#222}
header{background:#1E3D2F;color:#F7F3EA;padding:14px 20px;font-weight:700}
header span{color:#C9A227}
main{display:flex;height:calc(100vh - 52px)}
#list{width:340px;min-width:280px;border-right:1px solid #ddd;overflow-y:auto;background:#fff}
#list .item{padding:12px 14px;border-bottom:1px solid #eee;cursor:pointer}
#list .item:hover{background:#f5f5f5}#list .item.active{background:#eef4ef}
#list .subj{font-weight:600;font-size:14px}#list .to{font-size:12px;color:#666}#list .date{font-size:11px;color:#999}
#view{flex:1;overflow-y:auto;padding:20px}
#view iframe{width:100%;min-height:70vh;border:1px solid #ddd;border-radius:8px;background:#fff}
#view pre{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;white-space:pre-wrap;font-size:13px}
.tabs{margin-bottom:12px}.tabs button{margin-right:8px;padding:6px 14px;border:1px solid #1E3D2F;background:#fff;color:#1E3D2F;border-radius:6px;cursor:pointer}
.tabs button.on{background:#1E3D2F;color:#fff}
.empty{color:#888;padding:40px;text-align:center}
a.link{color:#1E3D2F}
</style></head><body>
<header>BrandForge <span>AI</span> — dev mail viewer</header>
<main><div id="list"></div><div id="view"><div class="empty">Select a message…</div></div></main>
<script>
const list=document.getElementById('list'),view=document.getElementById('view');
let current=null,mode='html';
async function load(){const r=await fetch('./messages',{credentials:'same-origin'});if(!r.ok){list.innerHTML='<div class="empty">unavailable</div>';return}
const msgs=await r.json();list.innerHTML=msgs.map(m=>'<div class="item" data-id="'+m.id+'"><div class="subj">'+esc(m.subject)+'</div><div class="to">'+esc(m.to)+'</div><div class="date">'+esc(m.date)+'</div></div>').join('')||'<div class="empty">no messages</div>';
list.querySelectorAll('.item').forEach(el=>el.onclick=()=>select(el.dataset.id,el));}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function select(id,el){list.querySelectorAll('.item').forEach(e=>e.classList.remove('active'));el.classList.add('active');
const r=await fetch('./messages/'+encodeURIComponent(id),{credentials:'same-origin'});current=await r.json();render();}
function render(){if(!current)return;const m=current;
const link=(m.text.match(/https?:\\/\\/[^\\s]+/)||[])[0]||'';
view.innerHTML='<h3 style="margin-top:0">'+esc(m.subject)+'</h3><p style="color:#666;font-size:13px">'+esc(m.from)+' → '+esc(m.to)+'<br>'+esc(m.date)+'</p>'
+(link?'<p><a class="link" href="'+esc(link)+'" target="_blank" rel="noopener">Open link ↗</a></p>':'')
+'<div class="tabs"><button id="tHtml" class="'+(mode==='html'?'on':'')+'">HTML</button><button id="tText" class="'+(mode==='text'?'on':'')+'">Text</button></div><div id="body"></div>';
document.getElementById('tHtml').onclick=()=>{mode='html';render()};document.getElementById('tText').onclick=()=>{mode='text';render()};
const body=document.getElementById('body');
if(mode==='html'&&m.html){const f=document.createElement('iframe');f.setAttribute('sandbox','');f.srcdoc=m.html;body.appendChild(f)}
else{const p=document.createElement('pre');p.textContent=m.text||'(empty)';body.appendChild(p)}}
load();
</script></body></html>`;

export async function devMailRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/admin/dev-mail';
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };

  // HTML viewer first (static segment beats :id)
  app.get(`${prefix}/view`, guard, async (_req, reply) => {
    if (!(await maildirAvailable())) return sendError(reply, 404, 'NOT_FOUND', 'Dev mail is only available in maildir mode');
    return reply.type('text/html').send(VIEWER_HTML);
  });

  app.get(`${prefix}/messages`, guard, async (_req, reply) => {
    if (!(await maildirAvailable())) return sendError(reply, 404, 'NOT_FOUND', 'Dev mail is only available in maildir mode');
    return listMessages();
  });

  app.get(`${prefix}/messages/:id`, guard, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    if (!(await maildirAvailable())) return sendError(reply, 404, 'NOT_FOUND', 'Dev mail is only available in maildir mode');
    const id = req.params.id;
    if (!ID_RE.test(id)) return sendError(reply, 400, 'BAD_REQUEST', 'Invalid message id');
    try {
      const raw = await readFile(path.join(config.maildirPath, path.basename(id)), 'utf8');
      const parsed = parseEml(raw);
      return { id, ...parsed };
    } catch {
      return sendError(reply, 404, 'NOT_FOUND', 'Message not found');
    }
  });
}
