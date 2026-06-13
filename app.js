// discuss — a Discourse-style forum on your Solid pod.
//
// Data lives same-origin as wherever the forum is hosted:
//   /public/discuss/index.jsonld                       forum meta + category list
//   /public/discuss/.acl                               owner Control; AuthenticatedAgent Append
//   /public/discuss/c/<cat>/<topicId>/topic.jsonld     the opening post + topic meta
//   /public/discuss/c/<cat>/<topicId>/<postId>.jsonld  one file per reply (append-only)
//
// One file per reply means many people post concurrently without clobbering —
// the topic container just collects everyone's docs.
//
// When there's no writable pod / index (e.g. opened on github.io while signed
// out) the app drops into a read-only DEMO over the sample data below.

const BASE = `${location.origin}/public/discuss/`
const INDEX_URL = `${BASE}index.jsonld`
const ACL_URL = `${BASE}.acl`
const CATS_BASE = `${BASE}c/`
const CTX = { schema: 'https://schema.org/', discuss: 'urn:discuss:' }

// ---------------------------------------------------------------- sample data
// Used both as the DEMO content and as the seed for a fresh forum's categories.
const SAMPLE = {
  categories: [
    {
      id: 'announcements', name: 'Announcements', color: '#e11d48',
      description: 'Releases, news, and anything the team wants everyone to see.',
      topics: [
        {
          id: 'welcome', title: 'Welcome to discuss 👋', pinned: true,
          author: 'melvin', when: '2d', replyCount: 2,
          posts: [
            { author: 'melvin', when: '2 days ago', text: "This forum lives entirely on your Solid pod.\n\nCategories hold topics; topics hold a thread of replies — all stored as JSON-LD you own. This is sample data; once it's running on a pod and you sign in, posts persist for real." },
            { author: 'ana', when: '2 days ago', text: 'Love that it’s just static files on the pod. No server, no database.' },
            { author: 'kenji', when: '1 day ago', text: 'And one file per reply, so multiple people can post without clobbering.' }
          ]
        }
      ]
    },
    {
      id: 'general', name: 'General', color: '#4f46e5',
      description: 'The catch-all. Introductions, off-topic, watercooler.',
      topics: [
        {
          id: 'introduce-yourself', title: 'Introduce yourself', pinned: false,
          author: 'ana', when: '5h', replyCount: 1,
          posts: [
            { author: 'ana', when: '5 hours ago', text: 'Hi all — building decentralized social stuff. Glad to be here.' },
            { author: 'sam', when: '3 hours ago', text: 'Welcome! Same boat. What pod provider are you on?' }
          ]
        }
      ]
    },
    {
      id: 'support', name: 'Support', color: '#0ea5a3',
      description: 'Questions, bug reports, and help with your pod.',
      topics: [
        {
          id: 'acl-not-inheriting', title: 'ACL not inheriting on new container?', pinned: false,
          author: 'sam', when: '3d', replyCount: 1,
          posts: [
            { author: 'sam', when: '3 days ago', text: 'I PUT an .acl with acl:default on the parent but child docs still 403 for other users. What am I missing?' },
            { author: 'melvin', when: '3 days ago', text: 'Point acl:default at "./" and use acl:AuthenticatedAgent, not a specific WebID.' }
          ]
        }
      ]
    }
  ]
}

const state = { categories: null, demo: false }

// ----------------------------------------------------------------- tiny utils
const app = document.getElementById('app')
const crumbsEl = document.getElementById('crumbs')
let renderToken = 0 // guards against async renders racing a hash change

function el(html) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function avatarColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 52%, 52%)`
}

function relTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (isNaN(t)) return String(iso)
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d`
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo`
  return `${Math.floor(mo / 12)}y`
}

function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'topic'
}

// ---------------------------------------------------------------- identity
function currentIdentity() {
  if (!window.xlogin || !window.xlogin.id) return null
  return { type: window.xlogin.type, id: window.xlogin.id }
}

function displayName(id) {
  if (!id) return 'anon'
  try {
    const u = new URL(id)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    return (seg || u.hostname).replace(/#.*$/, '')
  } catch {
    return id.length > 14 ? id.slice(0, 10) + '…' : id
  }
}

function authFetch(url, opts) {
  if (window.xlogin && window.xlogin.id && window.xlogin.authFetch) {
    return window.xlogin.authFetch(url, opts)
  }
  return fetch(url, opts)
}

function toast(msg) {
  let t = document.querySelector('.toast')
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(t._tid)
  t._tid = setTimeout(() => t.classList.remove('show'), 2400)
}

// ------------------------------------------------------------- data layer
async function loadJson(url) {
  const res = await authFetch(url, { headers: { Accept: 'application/ld+json' } })
  if (!res.ok) return null
  try { return await res.json() } catch { return null }
}

// returns absolute URLs of contained resources, or null on 404
async function listContainer(url) {
  const res = await authFetch(url, { headers: { Accept: 'application/ld+json' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  let doc; try { doc = await res.json() } catch { return [] }
  const c = doc['ldp:contains'] || doc['http://www.w3.org/ns/ldp#contains'] || doc.contains || []
  const arr = Array.isArray(c) ? c : [c]
  return arr
    .map(r => (typeof r === 'string' ? r : r && r['@id']))
    .filter(Boolean)
    .map(ref => { try { return new URL(ref, url).href } catch { return null } })
    .filter(Boolean)
}

function ownerAclId(identity) {
  if (identity.type === 'nostr') return `did:nostr:${identity.id}`
  return identity.id
}

function discussAcl(ownerId) {
  return {
    '@context': { acl: 'http://www.w3.org/ns/auth/acl#', foaf: 'http://xmlns.com/foaf/0.1/' },
    '@graph': [
      {
        '@id': '#owner', '@type': 'acl:Authorization',
        'acl:agent': { '@id': ownerId },
        'acl:accessTo': { '@id': './' }, 'acl:default': { '@id': './' },
        'acl:mode': [{ '@id': 'acl:Read' }, { '@id': 'acl:Write' }, { '@id': 'acl:Control' }]
      },
      {
        '@id': '#authenticated', '@type': 'acl:Authorization',
        'acl:agentClass': { '@id': 'acl:AuthenticatedAgent' },
        'acl:accessTo': { '@id': './' }, 'acl:default': { '@id': './' },
        'acl:mode': [{ '@id': 'acl:Read' }, { '@id': 'acl:Write' }, { '@id': 'acl:Append' }]
      },
      {
        '@id': '#public', '@type': 'acl:Authorization',
        'acl:agentClass': { '@id': 'foaf:Agent' },
        'acl:accessTo': { '@id': './' }, 'acl:default': { '@id': './' },
        'acl:mode': [{ '@id': 'acl:Read' }]
      }
    ]
  }
}

function defaultIndex() {
  return {
    '@context': CTX, '@id': '#forum', '@type': 'schema:DiscussionForumPosting',
    'schema:name': 'discuss',
    'discuss:categories': SAMPLE.categories.map(c => ({
      '@id': `#${c.id}`, 'schema:name': c.name,
      'discuss:color': c.color, 'schema:description': c.description
    }))
  }
}

async function put(url, body) {
  const res = await authFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/ld+json' },
    body: JSON.stringify(body)
  })
  if (!res.ok && res.status !== 201) throw new Error(`PUT ${url} → ${res.status}`)
  return res
}

async function seedForum() {
  const id = currentIdentity()
  if (!id) throw new Error('not signed in')
  await put(ACL_URL, discussAcl(ownerAclId(id)))   // ACL first so it inherits down
  await put(INDEX_URL, defaultIndex())
  try {
    await put(`${CATS_BASE}announcements/welcome/topic.jsonld`, {
      '@context': CTX, '@id': '#topic', '@type': 'schema:DiscussionForumPosting',
      'schema:headline': 'Welcome to discuss 👋',
      'schema:author': id.id, 'schema:datePublished': new Date().toISOString(),
      'discuss:pinned': true,
      'schema:text': 'This forum lives entirely on your Solid pod — categories, topics and replies, all JSON-LD you own.\n\nStart a topic with “+ New topic”, and anyone signed in can reply.'
    })
  } catch (e) { console.warn('welcome seed failed', e) }
}

function categoriesFrom(doc) {
  const list = doc['discuss:categories'] || doc.categories || []
  return (Array.isArray(list) ? list : [list]).map(c => ({
    id: (c['@id'] || '').replace(/^#/, '') || slug(c['schema:name'] || c.name || ''),
    name: c['schema:name'] || c.name || c['@id'],
    color: c['discuss:color'] || c.color || '#4f46e5',
    description: c['schema:description'] || c.description || ''
  })).filter(c => c.id && c.name)
}

async function loadCategories() {
  const res = await authFetch(INDEX_URL, { headers: { Accept: 'application/ld+json' } })
  if (res.ok) {
    const doc = await res.json()
    state.demo = false
    return categoriesFrom(doc)
  }
  if (res.status === 404) {
    if (currentIdentity()) {
      await seedForum()
      state.demo = false
      return categoriesFrom(defaultIndex())
    }
    state.demo = true
    return SAMPLE.categories.map(c => ({ id: c.id, name: c.name, color: c.color, description: c.description }))
  }
  throw new Error(`GET ${INDEX_URL} → ${res.status}`)
}

async function ensureCategories() {
  if (!state.categories) state.categories = await loadCategories()
  return state.categories
}

function resetData() { state.categories = null }

// topic-list metadata for a category
async function loadTopics(catId) {
  if (state.demo) {
    const c = SAMPLE.categories.find(x => x.id === catId)
    return c ? c.topics.map(t => ({ ...t, catId })) : []
  }
  const base = `${CATS_BASE}${encodeURIComponent(catId)}/`
  const entries = await listContainer(base)
  if (!entries) return []
  const dirs = entries.filter(u => u.endsWith('/'))
  const topics = await Promise.all(dirs.map(async dir => {
    const id = dir.replace(/\/$/, '').split('/').pop()
    const [inner, meta] = await Promise.all([
      listContainer(dir).catch(() => []),
      loadJson(`${dir}topic.jsonld`)
    ])
    if (!meta) return null
    const replies = (inner || []).filter(u => u.endsWith('.jsonld') && !u.endsWith('/topic.jsonld'))
    return {
      id: decodeURIComponent(id), catId,
      title: meta['schema:headline'] || meta.headline || '(untitled)',
      author: displayName(meta['schema:author']),
      when: relTime(meta['schema:datePublished']),
      date: meta['schema:datePublished'] || '',
      pinned: !!meta['discuss:pinned'],
      replyCount: replies.length
    }
  }))
  return topics.filter(Boolean)
}

async function loadTopic(catId, topicId) {
  if (state.demo) {
    const c = SAMPLE.categories.find(x => x.id === catId)
    const t = c && c.topics.find(x => x.id === topicId)
    return t ? { ...t, catId } : null
  }
  const dir = `${CATS_BASE}${encodeURIComponent(catId)}/${encodeURIComponent(topicId)}/`
  const meta = await loadJson(`${dir}topic.jsonld`)
  if (!meta) return null
  const inner = (await listContainer(dir).catch(() => [])) || []
  const replyUrls = inner.filter(u => u.endsWith('.jsonld') && !u.endsWith('/topic.jsonld'))
  const replies = (await Promise.all(replyUrls.map(async u => {
    const d = await loadJson(u)
    if (!d) return null
    return {
      author: displayName(d['schema:author'] || d.author),
      text: d['schema:text'] || d.text || '',
      date: d['schema:datePublished'] || d.datePublished || '',
      when: relTime(d['schema:datePublished'] || d.datePublished)
    }
  }))).filter(Boolean).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const op = {
    author: displayName(meta['schema:author']),
    text: meta['schema:text'] || '',
    when: relTime(meta['schema:datePublished']),
    date: meta['schema:datePublished'] || ''
  }
  return {
    id: topicId, catId,
    title: meta['schema:headline'] || '(untitled)',
    pinned: !!meta['discuss:pinned'],
    posts: [op, ...replies]
  }
}

async function createTopic(catId, title, body) {
  const id = currentIdentity()
  if (!id) throw new Error('not signed in')
  const tid = `${slug(title)}-${newId()}`
  await put(`${CATS_BASE}${encodeURIComponent(catId)}/${tid}/topic.jsonld`, {
    '@context': CTX, '@id': '#topic', '@type': 'schema:DiscussionForumPosting',
    'schema:headline': title, 'schema:author': id.id,
    'schema:datePublished': new Date().toISOString(), 'schema:text': body
  })
  return tid
}

async function createReply(catId, topicId, text) {
  const id = currentIdentity()
  if (!id) throw new Error('not signed in')
  const dir = `${CATS_BASE}${encodeURIComponent(catId)}/${encodeURIComponent(topicId)}/`
  await put(`${dir}${newId()}.jsonld`, {
    '@context': CTX, '@type': 'schema:Comment',
    'schema:author': id.id, 'schema:text': text,
    'schema:datePublished': new Date().toISOString()
  })
}

// --------------------------------------------------------------------- router
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '')
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts.length === 0) return { view: 'categories' }
  if (parts.length === 1) return { view: 'topics', cat: parts[0] }
  return { view: 'topic', cat: parts[0], topic: parts[1] }
}

function setCrumbs(items) {
  crumbsEl.innerHTML = ''
  items.forEach((it, i) => {
    if (i > 0) crumbsEl.appendChild(el('<span class="sep">›</span>'))
    crumbsEl.appendChild(el(it.href
      ? `<a href="${it.href}">${esc(it.label)}</a>`
      : `<span class="here">${esc(it.label)}</span>`))
  })
}

function showLoading(label) {
  app.innerHTML = ''
  app.appendChild(el(`<div class="cat-desc" style="padding:8px 2px">Loading ${esc(label)}…</div>`))
}

function demoNotice() {
  if (!state.demo) return ''
  return `<div class="notice">Demo data — install <b>discuss</b> on a Solid pod and sign in to read &amp; write for real.</div>`
}

async function render() {
  const route = parseHash()
  const token = ++renderToken
  try {
    await ensureCategories()
  } catch (e) {
    app.innerHTML = ''
    app.appendChild(el(`<div class="notice">Couldn’t load the forum (${esc(e.message)}). <a href="#/">Retry</a>.</div>`))
    return
  }
  if (token !== renderToken) return
  if (route.view === 'topics') return renderTopics(route.cat, token)
  if (route.view === 'topic') return renderTopic(route.cat, route.topic, token)
  return renderCategories(token)
}

const findCategory = id => (state.categories || []).find(c => c.id === id)

// ----------------------------------------------------------------- view: cats
async function renderCategories(token) {
  setCrumbs([{ label: 'Categories' }])
  showLoading('categories')
  const cats = state.categories || []
  // topic counts per category (skip in demo — use sample lengths)
  const counts = await Promise.all(cats.map(async c => {
    if (state.demo) {
      const s = SAMPLE.categories.find(x => x.id === c.id)
      return s ? s.topics.length : 0
    }
    const entries = await listContainer(`${CATS_BASE}${encodeURIComponent(c.id)}/`).catch(() => null)
    return entries ? entries.filter(u => u.endsWith('/')).length : 0
  }))
  if (token !== renderToken) return

  app.innerHTML = ''
  app.appendChild(el(demoNotice() || '<span></span>'))
  app.appendChild(el(`
    <div class="page-head">
      <h1>Categories</h1>
      <p>Pick a place to read or start a discussion.</p>
    </div>`))

  const list = el('<div class="list"></div>')
  cats.forEach((cat, i) => {
    const row = el(`
      <div class="row" role="link" tabindex="0">
        <span class="cat-badge" style="background:${cat.color}"></span>
        <div class="cat-body">
          <div class="cat-title">${esc(cat.name)}</div>
          <div class="cat-desc">${esc(cat.description)}</div>
        </div>
        <div class="cat-meta"><b>${counts[i]}</b> topics</div>
      </div>`)
    const go = () => { location.hash = `#/${encodeURIComponent(cat.id)}` }
    row.addEventListener('click', go)
    row.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
    list.appendChild(row)
  })
  app.appendChild(list)
}

// --------------------------------------------------------------- view: topics
async function renderTopics(catId, token) {
  const cat = findCategory(catId)
  if (!cat) return renderMissing('Category not found')
  setCrumbs([{ label: 'Categories', href: '#/' }, { label: cat.name }])
  showLoading(cat.name)
  let topics
  try { topics = await loadTopics(catId) } catch (e) { topics = [] }
  if (token !== renderToken) return
  topics.sort((a, b) => (b.pinned - a.pinned) || (b.date || '').localeCompare(a.date || ''))

  const signedIn = !!currentIdentity()
  app.innerHTML = ''
  app.appendChild(el(demoNotice() || '<span></span>'))
  app.appendChild(el(`
    <div class="page-head">
      <span class="cat-badge" style="background:${cat.color};width:14px;height:22px;border-radius:5px"></span>
      <h1>${esc(cat.name)}</h1>
      <span class="spacer"></span>
      <button class="btn" id="new-topic" ${signedIn ? '' : 'disabled title="Sign in to start a topic"'}>+ New topic</button>
    </div>`))
  app.appendChild(el(`<div class="cat-desc" style="margin:-8px 0 18px">${esc(cat.description)}</div>`))

  // inline new-topic form (hidden until the button is pressed)
  const form = el(`
    <div class="newtopic" hidden>
      <input class="nt-title" type="text" placeholder="Topic title" maxlength="140">
      <textarea class="nt-body" placeholder="Write the first post…"></textarea>
      <div class="compose-bar">
        <button class="btn nt-create">Create topic</button>
        <button class="btn btn-ghost nt-cancel">Cancel</button>
      </div>
    </div>`)
  app.appendChild(form)
  if (signedIn) {
    const btn = document.getElementById('new-topic')
    const titleEl = form.querySelector('.nt-title')
    const bodyEl = form.querySelector('.nt-body')
    btn.addEventListener('click', () => { form.hidden = !form.hidden; if (!form.hidden) titleEl.focus() })
    form.querySelector('.nt-cancel').addEventListener('click', () => { form.hidden = true })
    form.querySelector('.nt-create').addEventListener('click', async () => {
      const title = titleEl.value.trim(); const body = bodyEl.value.trim()
      if (!title) { titleEl.focus(); return }
      const create = form.querySelector('.nt-create'); create.disabled = true; create.textContent = 'Creating…'
      try {
        let tid
        if (state.demo) {
          tid = `${slug(title)}-${newId()}`
          const s = SAMPLE.categories.find(x => x.id === catId)
          s.topics.unshift({ id: tid, title, pinned: false, author: 'me', when: 'just now', replyCount: 0,
            posts: [{ author: displayName(currentIdentity()?.id) || 'me', when: 'just now', text: body, unsaved: true }] })
        } else {
          tid = await createTopic(catId, title, body)
        }
        location.hash = `#/${encodeURIComponent(catId)}/${encodeURIComponent(tid)}`
      } catch (e) {
        toast('Could not create topic: ' + e.message)
        create.disabled = false; create.textContent = 'Create topic'
      }
    })
  }

  if (!topics.length) {
    app.appendChild(el(`<div class="cat-desc" style="padding:18px 2px">No topics yet${signedIn ? ' — start one above.' : '. Sign in to start one.'}</div>`))
    return
  }
  const list = el('<div class="list"></div>')
  for (const t of topics) {
    const row = el(`
      <div class="row" role="link" tabindex="0">
        <div class="topic-main">
          <div class="topic-title">${t.pinned ? '📌 ' : ''}${esc(t.title)}</div>
          <div class="topic-sub">
            <span class="pill">${esc(cat.name)}</span>
            <span>by ${esc(t.author)}</span>
          </div>
        </div>
        <div class="topic-stat"><div class="n">${t.replyCount}</div><div class="l">replies</div></div>
        <div class="topic-when">${esc(t.when)}</div>
      </div>`)
    const go = () => { location.hash = `#/${encodeURIComponent(catId)}/${encodeURIComponent(t.id)}` }
    row.addEventListener('click', go)
    row.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
    list.appendChild(row)
  }
  app.appendChild(list)
}

// ---------------------------------------------------------------- view: topic
async function renderTopic(catId, topicId, token) {
  const cat = findCategory(catId)
  if (!cat) return renderMissing('Category not found')
  setCrumbs([
    { label: 'Categories', href: '#/' },
    { label: cat.name, href: `#/${encodeURIComponent(cat.id)}` },
    { label: '…' }
  ])
  showLoading('topic')
  let topic
  try { topic = await loadTopic(catId, topicId) } catch (e) { topic = null }
  if (token !== renderToken) return
  if (!topic) return renderMissing('Topic not found')

  setCrumbs([
    { label: 'Categories', href: '#/' },
    { label: cat.name, href: `#/${encodeURIComponent(cat.id)}` },
    { label: topic.title }
  ])
  app.innerHTML = ''
  app.appendChild(el(`
    <div class="thread-head">
      <h1>${topic.pinned ? '📌 ' : ''}${esc(topic.title)}</h1>
      <div class="meta">in <a href="#/${encodeURIComponent(cat.id)}">${esc(cat.name)}</a> · ${topic.posts.length} posts</div>
    </div>`))

  topic.posts.forEach((p, i) => {
    app.appendChild(el(`
      <div class="post${i === 0 ? ' op' : ''}">
        <div class="avatar" style="background:${avatarColor(p.author)}">${esc((p.author[0] || '?').toUpperCase())}</div>
        <div class="post-body">
          <div class="post-head">
            <span class="post-author">${esc(p.author)}</span>
            <span class="post-when">${esc(p.when)}</span>
            ${p.unsaved ? '<span class="unsaved">unsaved</span>' : ''}
          </div>
          <div class="post-text">${esc(p.text)}</div>
        </div>
      </div>`))
  })

  app.appendChild(buildCompose(cat, topic))
}

// reply composer — persists to the pod (or appends in-memory in demo)
function buildCompose(cat, topic) {
  const id = currentIdentity()
  const box = el(`
    <div class="compose">
      <textarea placeholder="${id ? 'Write a reply…  (⌘/Ctrl+Enter to post)' : 'Sign in to reply…'}"${id ? '' : ' disabled'}></textarea>
      <div class="compose-bar">
        <button class="btn" ${id ? '' : 'disabled'}>Post reply</button>
        <span class="cat-desc">${id ? (state.demo ? 'Demo — replies are in-memory only.' : 'Saved to the pod as JSON-LD.') : 'Sign in (top-right) to join the discussion.'}</span>
      </div>
    </div>`)
  if (!id) return box
  const ta = box.querySelector('textarea')
  const btn = box.querySelector('button')
  const submit = async () => {
    const text = ta.value.trim()
    if (!text) return
    btn.disabled = true; btn.textContent = 'Posting…'
    try {
      if (state.demo) {
        topic.posts.push({ author: displayName(id.id), when: 'just now', text, unsaved: true })
        await render()
        toast('Reply added (demo — not saved)')
      } else {
        await createReply(cat.id, topic.id, text)
        await render() // re-fetch the thread, now including the saved reply
        toast('Reply posted')
      }
    } catch (e) {
      toast('Could not post: ' + e.message)
      btn.disabled = false; btn.textContent = 'Post reply'
    }
  }
  btn.addEventListener('click', submit)
  ta.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit() })
  return box
}

function renderMissing(msg) {
  setCrumbs([{ label: 'Categories', href: '#/' }, { label: 'Not found' }])
  app.innerHTML = ''
  app.appendChild(el(`<div class="notice">${esc(msg)}. <a href="#/">Back to categories</a>.</div>`))
}

// --------------------------------------------------------------- sign-in
function refreshAccount() {
  const signinBtn = document.getElementById('signin')
  const account = document.getElementById('account')
  const id = currentIdentity()
  if (id) {
    const name = displayName(id.id)
    signinBtn.hidden = true
    account.hidden = false
    const av = document.getElementById('me-avatar')
    av.textContent = (name[0] || '?').toUpperCase()
    av.style.background = avatarColor(name)
    const nm = document.getElementById('me-name')
    nm.textContent = name; nm.title = id.id
  } else {
    signinBtn.hidden = false
    account.hidden = true
  }
}

function wireSignIn() {
  document.getElementById('signin').addEventListener('click', () => {
    if (window.xlogin && window.xlogin.login) window.xlogin.login()
    else toast('xlogin not available — open this app from a pod.')
  })
  document.getElementById('signout').addEventListener('click', () => {
    if (window.xlogin && window.xlogin.logout) window.xlogin.logout()
  })
  // session changes: forget cached categories (demo→live), refresh, re-render
  document.addEventListener('xlogin', () => { resetData(); refreshAccount(); render() })
  document.addEventListener('xlogout', () => { resetData(); refreshAccount(); render() })
}

// ----------------------------------------------------------------- bootstrap
window.addEventListener('hashchange', render)
wireSignIn();
(async () => {
  try { if (window.xlogin && window.xlogin.ready) await window.xlogin.ready } catch {}
  refreshAccount()
  render()
})()
