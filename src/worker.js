// Project Log API. Reads are public. Every write needs the edit passcode
// (header x-edit-key) that matches the EDIT_PASSCODE secret.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// Images are stored as base64 text in D1 (a row can hold about 2 MB).
// The page shrinks every photo to a JPEG under this size before upload.
const MAX_B64 = 1800000;
const MAX_IMAGES = 12;
const MIME_MAGIC = { 'image/jpeg': '/9j/', 'image/png': 'iVBOR', 'image/webp': 'UklGR' };

// Sales steps of a project, in order. A step can hold photos and PDFs.
const STAGES = ['rfq', 'quotation', 'po', 'invoice'];
const MAX_STAGE_FILES = 6;
const FILE_MAGIC = { ...MIME_MAGIC, 'application/pdf': 'JVBER' };

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const date = (v) => (typeof v === 'string' && (v === '' || DATE_RE.test(v)) ? v : '');
const num = (v) => (Number.isFinite(+v) ? +v : 0);

// API field -> [column, cleaner]
const FIELDS = {
  group: ['grp', (v) => str(v, 120)],
  name: ['name', (v) => str(v, 160)],
  incharge: ['incharge', (v) => str(v, 120)],
  planStart: ['plan_start', date],
  planDue: ['plan_due', date],
  actStart: ['act_start', date],
  actEnd: ['act_end', date],
  order: ['ord', num],
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function isEditor(request, env) {
  const given = request.headers.get('x-edit-key') || '';
  if (!env.EDIT_PASSCODE || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(env.EDIT_PASSCODE)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

function taskRow(projectId, t) {
  const row = { id: crypto.randomUUID(), project_id: projectId };
  for (const [key, [col, clean]] of Object.entries(FIELDS)) row[col] = clean(t[key]);
  return row;
}

function insertTask(env, r) {
  return env.DB.prepare(
    'INSERT INTO tasks (id, project_id, grp, name, incharge, plan_start, plan_due, act_start, act_end, ord) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(r.id, r.project_id, r.grp, r.name, r.incharge, r.plan_start, r.plan_due, r.act_start, r.act_end, r.ord);
}

// Swap the order values of two rows in the same project (move up / move down).
async function swapOrder(env, table, a, b) {
  if (!ID_RE.test(a || '') || !ID_RE.test(b || '')) return json({ error: 'Bad request.' }, 400);
  const q = `SELECT id, project_id, ord FROM ${table} WHERE id = ?`;
  const [ra, rb] = await Promise.all([env.DB.prepare(q).bind(a).first(), env.DB.prepare(q).bind(b).first()]);
  if (!ra || !rb || ra.project_id !== rb.project_id) return json({ error: 'Bad request.' }, 400);
  await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET ord = ? WHERE id = ?`).bind(rb.ord, ra.id),
    env.DB.prepare(`UPDATE ${table} SET ord = ? WHERE id = ?`).bind(ra.ord, rb.id),
  ]);
  return json({ ok: true });
}

// Adds the sales-step column and file table the first time the API runs after an update,
// so nothing has to be run by hand in the D1 console. Safe to repeat.
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      try {
        await env.DB.prepare("ALTER TABLE projects ADD COLUMN stage TEXT NOT NULL DEFAULT ''").run();
      } catch (e) { /* column already there */ }
      try {
        await env.DB.prepare("ALTER TABLE projects ADD COLUMN stage_who TEXT NOT NULL DEFAULT '{}'").run();
      } catch (e) { /* column already there */ }
      await env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS stage_files (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, stage TEXT NOT NULL, name TEXT NOT NULL DEFAULT \'\', mime TEXT NOT NULL, data_b64 TEXT NOT NULL, ord REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)'
      ).run();
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_stage_files_project ON stage_files(project_id, stage, ord)').run();
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

async function handleApi(request, env, url) {
  await ensureSchema(env);
  const { pathname } = url;
  const method = request.method;
  let m;

  if (method === 'GET' && pathname === '/api/data') {
    const [p, t, i, sf] = await Promise.all([
      env.DB.prepare('SELECT id, name, client, po, notes, stage, stage_who, created_at AS createdAt FROM projects ORDER BY created_at DESC').all(),
      env.DB.prepare(
        'SELECT id, project_id AS projectId, grp AS "group", name, incharge, plan_start AS planStart, plan_due AS planDue, act_start AS actStart, act_end AS actEnd, ord AS "order" FROM tasks ORDER BY project_id, ord'
      ).all(),
      env.DB.prepare('SELECT id, project_id AS projectId, caption, ord AS "order" FROM images ORDER BY project_id, ord').all(),
      env.DB.prepare('SELECT id, project_id AS projectId, stage, name, mime, ord AS "order" FROM stage_files ORDER BY project_id, stage, ord').all(),
    ]);
    const projects = p.results.map(({ stage_who, ...r }) => {
      let who = {};
      try { who = JSON.parse(stage_who || '{}') || {}; } catch (e) { /* ignore */ }
      return { ...r, stageWho: who };
    });
    return json({ projects, tasks: t.results, images: i.results, stageFiles: sf.results });
  }

  // Public: the image bytes. Ids never change content, so they cache forever.
  m = pathname.match(/^\/api\/images\/([^/]+)$/);
  if (m && ID_RE.test(m[1]) && method === 'GET') {
    const row = await env.DB.prepare('SELECT mime, data_b64 FROM images WHERE id = ?').bind(m[1]).first();
    if (!row) return new Response('Not found', { status: 404 });
    const bin = Uint8Array.from(atob(row.data_b64), (c) => c.charCodeAt(0));
    return new Response(bin, {
      headers: {
        'content-type': row.mime,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  // Public: a file attached to a sales step (photo or PDF).
  m = pathname.match(/^\/api\/stage-files\/([^/]+)$/);
  if (m && ID_RE.test(m[1]) && method === 'GET') {
    const row = await env.DB.prepare('SELECT name, mime, data_b64 FROM stage_files WHERE id = ?').bind(m[1]).first();
    if (!row) return new Response('Not found', { status: 404 });
    const bin = Uint8Array.from(atob(row.data_b64), (c) => c.charCodeAt(0));
    const safe = (row.name || 'file').replace(/[\r\n"\\]/g, '_');
    return new Response(bin, {
      headers: {
        'content-type': row.mime,
        'content-disposition': "inline; filename*=UTF-8''" + encodeURIComponent(safe),
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  // Everything below changes data.
  if (!(await isEditor(request, env))) return json({ error: 'Editing needs the passcode.' }, 401);

  if (method === 'POST' && pathname === '/api/auth') return json({ ok: true });

  if (method === 'POST' && pathname === '/api/projects') {
    const b = await body(request);
    const name = b && str(b.name, 160);
    if (!name) return json({ error: 'Project name is required.' }, 400);
    const id = crypto.randomUUID();
    const stmts = [
      env.DB.prepare('INSERT INTO projects (id, name, client, po, notes, stage, created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, name, str(b.client, 160), str(b.po, 60), str(b.notes, 4000), STAGES.includes(b.stage) ? b.stage : '', Date.now()),
    ];
    if (Array.isArray(b.tasks)) b.tasks.slice(0, 80).forEach((t) => stmts.push(insertTask(env, taskRow(id, t || {}))));
    await env.DB.batch(stmts);
    return json({ id }, 201);
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (m && ID_RE.test(m[1])) {
    const id = m[1];
    if (method === 'PATCH') {
      const b = await body(request);
      if (!b) return json({ error: 'Bad request.' }, 400);
      const sets = [], vals = [];
      if ('name' in b) {
        const name = str(b.name, 160);
        if (!name) return json({ error: 'Project name is required.' }, 400);
        sets.push('name = ?'); vals.push(name);
      }
      if ('client' in b) { sets.push('client = ?'); vals.push(str(b.client, 160)); }
      if ('po' in b) { sets.push('po = ?'); vals.push(str(b.po, 60)); }
      if ('notes' in b) { sets.push('notes = ?'); vals.push(str(b.notes, 4000)); }
      if ('stage' in b) {
        if (b.stage !== '' && !STAGES.includes(b.stage)) return json({ error: 'Unknown sales step.' }, 400);
        sets.push('stage = ?'); vals.push(b.stage);
      }
      if ('stageWho' in b) {
        const src = b.stageWho && typeof b.stageWho === 'object' ? b.stageWho : {};
        const clean = {};
        for (const st of STAGES) { const v = str(src[st], 120); if (v) clean[st] = v; }
        sets.push('stage_who = ?'); vals.push(JSON.stringify(clean));
      }
      if (!sets.length) return json({ error: 'Nothing to update.' }, 400);
      await env.DB.prepare('UPDATE projects SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals, id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM tasks WHERE project_id = ?').bind(id),
        env.DB.prepare('DELETE FROM images WHERE project_id = ?').bind(id),
        env.DB.prepare('DELETE FROM stage_files WHERE project_id = ?').bind(id),
        env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }

  // Duplicate a project as the starting point for a new one. Actual dates are never copied.
  m = pathname.match(/^\/api\/projects\/([^/]+)\/duplicate$/);
  if (m && ID_RE.test(m[1]) && method === 'POST') {
    const src = m[1];
    const b = (await body(request)) || {};
    const p = await env.DB.prepare('SELECT name, client, po, notes FROM projects WHERE id = ?').bind(src).first();
    if (!p) return json({ error: 'Project not found.' }, 404);
    const id = crypto.randomUUID();
    const keep = b.keepDates ? 1 : 0;
    const name = str(b.name, 160) || (p.name + ' (copy)').slice(0, 160);
    const stmts = [
      env.DB.prepare('INSERT INTO projects (id, name, client, po, notes, created_at) VALUES (?,?,?,?,?,?)')
        .bind(id, name, 'client' in b ? str(b.client, 160) : p.client, 'po' in b ? str(b.po, 60) : p.po, p.notes, Date.now()),
      env.DB.prepare(
        "INSERT INTO tasks (id, project_id, grp, name, incharge, plan_start, plan_due, act_start, act_end, ord) " +
        "SELECT lower(hex(randomblob(16))), ?, grp, name, incharge, CASE WHEN ? = 1 THEN plan_start ELSE '' END, CASE WHEN ? = 1 THEN plan_due ELSE '' END, '', '', ord FROM tasks WHERE project_id = ?"
      ).bind(id, keep, keep, src),
    ];
    if (b.copyImages) {
      stmts.push(env.DB.prepare(
        'INSERT INTO images (id, project_id, caption, mime, data_b64, ord, created_at) ' +
        'SELECT lower(hex(randomblob(16))), ?, caption, mime, data_b64, ord, ? FROM images WHERE project_id = ?'
      ).bind(id, Date.now(), src));
    }
    await env.DB.batch(stmts);
    return json({ id }, 201);
  }

  // Rename a main process (applies to every sub process under it).
  m = pathname.match(/^\/api\/projects\/([^/]+)\/rename-group$/);
  if (m && ID_RE.test(m[1]) && method === 'POST') {
    const b = await body(request);
    const from = b && str(b.from, 120), to = b && str(b.to, 120);
    if (!from || !to) return json({ error: 'Enter a name for the main process.' }, 400);
    await env.DB.prepare('UPDATE tasks SET grp = ? WHERE project_id = ? AND grp = ?').bind(to, m[1], from).run();
    return json({ ok: true });
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/);
  if (m && ID_RE.test(m[1]) && method === 'POST') {
    const projectId = m[1];
    const b = await body(request);
    if (!b) return json({ error: 'Bad request.' }, 400);
    const list = Array.isArray(b.tasks) ? b.tasks.slice(0, 80) : [b];
    const rows = list.map((t) => taskRow(projectId, t || {}));
    if (rows.some((r) => !r.grp || !r.name)) return json({ error: 'Main process and sub process are required.' }, 400);
    await env.DB.batch(rows.map((r) => insertTask(env, r)));
    return json({ ids: rows.map((r) => r.id) }, 201);
  }

  if (method === 'POST' && pathname === '/api/tasks/swap') {
    const b = (await body(request)) || {};
    return swapOrder(env, 'tasks', b.a, b.b);
  }

  m = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (m && ID_RE.test(m[1])) {
    const id = m[1];
    if (method === 'PATCH') {
      const b = await body(request);
      if (!b) return json({ error: 'Bad request.' }, 400);
      const sets = [], vals = [];
      for (const [key, [col, clean]] of Object.entries(FIELDS)) {
        if (key in b) { sets.push(col + ' = ?'); vals.push(clean(b[key])); }
      }
      if (!sets.length) return json({ error: 'Nothing to update.' }, 400);
      await env.DB.prepare('UPDATE tasks SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals, id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  /* ---- sales step files (photo or PDF) ---- */
  m = pathname.match(/^\/api\/projects\/([^/]+)\/stage-files$/);
  if (m && ID_RE.test(m[1]) && method === 'POST') {
    const projectId = m[1];
    const b = await body(request);
    const mime = b && b.mime, data = b && b.data;
    if (!b || !STAGES.includes(b.stage)) return json({ error: 'Unknown sales step.' }, 400);
    if (!FILE_MAGIC[mime] || typeof data !== 'string' || !B64_RE.test(data) || !data.startsWith(FILE_MAGIC[mime])) {
      return json({ error: 'Use a photo (JPG, PNG, WebP) or a PDF file.' }, 400);
    }
    if (data.length > MAX_B64) return json({ error: 'That file is too large. The limit is about 1.3 MB.' }, 400);
    const proj = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
    if (!proj) return json({ error: 'Project not found.' }, 404);
    const stat = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(ord), 0) AS mx FROM stage_files WHERE project_id = ? AND stage = ?').bind(projectId, b.stage).first();
    if (stat.n >= MAX_STAGE_FILES) return json({ error: 'Up to ' + MAX_STAGE_FILES + ' files in each step.' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO stage_files (id, project_id, stage, name, mime, data_b64, ord, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, projectId, b.stage, str(b.name, 120), mime, data, stat.mx + 10, Date.now()).run();
    return json({ id }, 201);
  }

  m = pathname.match(/^\/api\/stage-files\/([^/]+)$/);
  if (m && ID_RE.test(m[1]) && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM stage_files WHERE id = ?').bind(m[1]).run();
    return json({ ok: true });
  }

  /* ---- subject images ---- */
  m = pathname.match(/^\/api\/projects\/([^/]+)\/images$/);
  if (m && ID_RE.test(m[1]) && method === 'POST') {
    const projectId = m[1];
    const b = await body(request);
    const mime = b && b.mime, data = b && b.data;
    if (!MIME_MAGIC[mime] || typeof data !== 'string' || !B64_RE.test(data) || !data.startsWith(MIME_MAGIC[mime])) {
      return json({ error: 'That file is not a JPG, PNG or WebP image.' }, 400);
    }
    if (data.length > MAX_B64) return json({ error: 'That image is too large. Use a smaller one.' }, 400);
    const proj = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
    if (!proj) return json({ error: 'Project not found.' }, 404);
    const stat = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(ord), 0) AS mx FROM images WHERE project_id = ?').bind(projectId).first();
    if (stat.n >= MAX_IMAGES) return json({ error: 'Up to ' + MAX_IMAGES + ' images per project.' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO images (id, project_id, caption, mime, data_b64, ord, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, projectId, str(b.caption, 200), mime, data, stat.mx + 10, Date.now()).run();
    return json({ id }, 201);
  }

  if (method === 'POST' && pathname === '/api/images/swap') {
    const b = (await body(request)) || {};
    return swapOrder(env, 'images', b.a, b.b);
  }

  m = pathname.match(/^\/api\/images\/([^/]+)$/);
  if (m && ID_RE.test(m[1])) {
    const id = m[1];
    if (method === 'PATCH') {
      const b = await body(request);
      if (!b || !('caption' in b)) return json({ error: 'Nothing to update.' }, 400);
      await env.DB.prepare('UPDATE images SET caption = ? WHERE id = ?').bind(str(b.caption, 200), id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM images WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        console.error(e);
        return json({ error: 'Server error.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
