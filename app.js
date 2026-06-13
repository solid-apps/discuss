// discuss — a Discourse-style forum on your Solid pod.
//
//   /public/discuss/index.jsonld                       forum meta + category list
//   /public/discuss/.acl                               owner Control; AuthenticatedAgent Append
//   /public/discuss/c/<cat>/<topicId>/topic.jsonld     the opening post + topic meta
//   /public/discuss/c/<cat>/<topicId>/<postId>.jsonld  one file per reply (append-only)
//   /public/discuss/c/<cat>/<topicId>/like_<t>_<u>.jsonld  one file per like
//
// One file per reply means many people post concurrently without clobbering.
// When there's no writable pod / index (e.g. opened on github.io while signed
// out) the app drops into a read-only DEMO over the sample data below.

// The forum data lives on the SIGNED-IN USER's pod — not on whatever origin is
// serving the app (it may be hosted off-pod). We resolve the pod root from the
// WebID's pim:storage (falling back to the WebID's origin), then recompute URLs.
let POD_ROOT, BASE, INDEX_URL, ACL_URL, CATS_BASE
function setPodRoot(root) {
  POD_ROOT = String(root).replace(/\/+$/, '') + '/'
  BASE = `${POD_ROOT}public/discuss/`
  INDEX_URL = `${BASE}index.jsonld`
  ACL_URL = `${BASE}.acl`
  CATS_BASE = `${BASE}c/`
}
setPodRoot(location.origin)
const CTX = { schema: 'https://schema.org/', discuss: 'urn:discuss:' }

// ---------------------------------------------------------------- sample data
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
            { author: 'melvin', when: '2 days ago', text: "This forum lives entirely on your Solid pod.\n\nMarkdown works: **bold**, *italic*, `code`, [links](https://solidproject.org), and:\n\n> blockquotes\n\n- bullet lists\n- one file per reply" },
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

// unread tracking — remember how many replies we'd seen per topic (no extra fetches)
const SEEN_KEY = 'discuss:seen'
function loadSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') } catch { return {} } }
function seenCount(catId, topicId) { return loadSeen()[`${catId}/${topicId}`] }
function markSeen(catId, topicId, replyCount) {
  const m = loadSeen(); m[`${catId}/${topicId}`] = replyCount
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(m)) } catch {}
}

function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'topic'
}

// ------------------------------------------------------------- markdown (safe)
// Input is HTML-escaped before any transform; we only ever emit a fixed set of
// tags and links are restricted to http(s)/mailto, so post bodies can't inject.
function mdInline(escaped) {
  // split out `code` spans so inline rules never touch their contents
  return escaped.split(/(`[^`]+`)/).map(part => {
    if (part.length > 1 && part[0] === '`' && part[part.length - 1] === '`') {
      return `<code>${part.slice(1, -1)}</code>`
    }
    let s = part
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g,
      (_, txt, url) => `<a href="${url}" target="_blank" rel="noopener nofollow">${txt}</a>`)
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener nofollow">${url}</a>`)
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    s = s.replace(/(^|\s)@([a-zA-Z0-9._-]{2,})/g, '$1<span class="mention">@$2</span>')
    return s
  }).join('')
}

function renderMarkdown(src) {
  const lines = String(src || '').split('\n')
  const inline = s => mdInline(esc(s))
  const isPlain = l => /^\s*$/.test(l) || /^\s*```/.test(l) || /^\s*>\s?/.test(l) ||
    /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || /^#{1,3}\s+/.test(l)
  let html = '', i = 0
  while (i < lines.length) {
    const line = lines[i]
    let m
    if (/^\s*$/.test(line)) { i++; continue }
    if (/^\s*```/.test(line)) { // fenced code block
      i++
      const buf = []
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++ }
      if (i < lines.length) i++
      html += `<pre class="md-pre"><code>${esc(buf.join('\n'))}</code></pre>`
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      html += `<blockquote>${buf.map(inline).join('<br>')}</blockquote>`; continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++ }
      html += `<ul>${buf.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`; continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++ }
      html += `<ol>${buf.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`; continue
    }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      const lv = m[1].length + 2
      html += `<h${lv} class="md-h">${inline(m[2])}</h${lv}>`; i++; continue
    }
    const buf = []
    while (i < lines.length && !isPlain(lines[i])) { buf.push(lines[i]); i++ }
    html += `<p>${buf.map(inline).join('<br>')}</p>`
  }
  return html
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

// ------------------------------------------------------------- pod resolution
const STORAGE_IRI = 'http://www.w3.org/ns/pim/space#storage'

function storageFromJsonld(txt) {
  let doc; try { doc = JSON.parse(txt) } catch { return null }
  const nodes = Array.isArray(doc) ? doc : (Array.isArray(doc['@graph']) ? doc['@graph'] : [doc])
  for (const n of nodes) {
    for (const k of Object.keys(n || {})) {
      if (k === STORAGE_IRI || k === 'storage' || k === 'pim:storage' || k === 'space:storage' || k.endsWith('space#storage')) {
        const v = Array.isArray(n[k]) ? n[k][0] : n[k]
        const url = typeof v === 'string' ? v : (v && v['@id'])
        if (url) return url
      }
    }
  }
  return null
}

function storageFromTurtle(txt) {
  const m = txt.match(/(?:pim:storage|space:storage|<http:\/\/www\.w3\.org\/ns\/pim\/space#storage>)\s+<([^>]+)>/)
  return m ? m[1] : null
}

async function podRootForWebId(webId) {
  try {
    const res = await authFetch(webId, { headers: { Accept: 'application/ld+json, text/turtle;q=0.9' } })
    if (res.ok) {
      const ct = res.headers.get('content-type') || ''
      const txt = await res.text()
      const storage = ct.includes('json')
        ? (storageFromJsonld(txt) || storageFromTurtle(txt))
        : (storageFromTurtle(txt) || storageFromJsonld(txt))
      if (storage) return new URL(storage, webId).href
    }
  } catch (e) { console.warn('pod resolve failed, using origin', e) }
  return new URL(webId).origin + '/'
}

async function resolvePod() {
  const id = currentIdentity()
  if (!id || id.type === 'nostr') { setPodRoot(location.origin); return }
  setPodRoot(await podRootForWebId(id.id))
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

async function put(url, body) {
  const res = await authFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/ld+json' },
    body: JSON.stringify(body)
  })
  if (!res.ok && res.status !== 201) throw new Error(`PUT ${url} → ${res.status}`)
  return res
}

async function deleteResource(url) {
  const r = await authFetch(url, { method: 'DELETE' })
  if (!r.ok && ![204, 205, 404].includes(r.status)) throw new Error(`DELETE ${url} → ${r.status}`)
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

function catToJsonld(c) {
  return { '@id': `#${c.id}`, 'schema:name': c.name, 'discuss:color': c.color, 'schema:description': c.description }
}

function defaultIndex() {
  return {
    '@context': CTX, '@id': '#forum', '@type': 'schema:DiscussionForumPosting',
    'schema:name': 'discuss',
    'discuss:categories': SAMPLE.categories.map(catToJsonld)
  }
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
      'schema:text': 'This forum lives entirely on your Solid pod — categories, topics and replies, all JSON-LD you own.\n\n**Markdown** works in posts: *italic*, `code`, [links](https://solidproject.org), > quotes and lists.\n\nStart a topic with “+ New topic”, and anyone signed in can reply.'
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

let categoriesPromise = null
async function ensureCategories() {
  if (state.categories) return state.categories
  if (!categoriesPromise) {
    categoriesPromise = loadCategories()
      .then(c => { state.categories = c; return c })
      .finally(() => { categoriesPromise = null })
  }
  return categoriesPromise
}

function resetData() { state.categories = null; categoriesPromise = null }

// ---- category management (writes index.jsonld / mutates SAMPLE in demo) ----
function pickCat(c) { return { id: c.id, name: c.name, color: c.color, description: c.description } }
function uniqueCatId(base, ids) {
  if (!ids.has(base)) return base
  let i = 2; while (ids.has(`${base}-${i}`)) i++; return `${base}-${i}`
}
async function saveCategoryList(cats) {
  const doc = (await loadJson(INDEX_URL)) || defaultIndex()
  doc['@context'] = doc['@context'] || CTX
  doc['discuss:categories'] = cats.map(catToJsonld)
  await put(INDEX_URL, doc)
}
async function addCategory({ name, color, description }) {
  if (state.demo) {
    const id = uniqueCatId(slug(name), new Set(SAMPLE.categories.map(c => c.id)))
    SAMPLE.categories.push({ id, name, color, description, topics: [] })
    return id
  }
  const cur = (state.categories || []).map(pickCat)
  const id = uniqueCatId(slug(name), new Set(cur.map(c => c.id)))
  await saveCategoryList([...cur, { id, name, color, description }])
  return id
}
async function updateCategory(id, fields) {
  if (state.demo) {
    const c = SAMPLE.categories.find(x => x.id === id); if (c) Object.assign(c, fields)
    return
  }
  await saveCategoryList((state.categories || []).map(c => c.id === id ? { ...pickCat(c), ...fields } : pickCat(c)))
}

// ------------------------------------------------------------- topics / posts
const replyFilesOf = urls => (urls || []).filter(u => {
  const n = u.split('/').pop()
  return u.endsWith('.jsonld') && n !== 'topic.jsonld' && !n.startsWith('like_')
})

async function loadTopics(catId) {
  if (state.demo) {
    const c = SAMPLE.categories.find(x => x.id === catId)
    return c ? c.topics.map(t => ({
      ...t, catId, lastAuthor: t.posts[t.posts.length - 1]?.author || t.author,
      lastWhen: t.when, lastDate: t.date || ''
    })) : []
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
    const replies = replyFilesOf(inner)
    // newest reply = lexicographically largest filename (ids are time-sortable)
    let lastDate = meta['schema:datePublished'] || ''
    let lastAuthor = displayName(meta['schema:author'])
    if (replies.length) {
      const latest = replies.slice().sort((a, b) => a.split('/').pop().localeCompare(b.split('/').pop())).pop()
      const d = await loadJson(latest)
      if (d) {
        lastDate = d['schema:datePublished'] || lastDate
        lastAuthor = displayName(d['schema:author'] || d.author)
      }
    }
    return {
      id: decodeURIComponent(id), catId,
      title: meta['schema:headline'] || meta.headline || '(untitled)',
      author: displayName(meta['schema:author']),
      date: meta['schema:datePublished'] || '',
      pinned: !!meta['discuss:pinned'],
      replyCount: replies.length,
      lastDate, lastAuthor, lastWhen: relTime(lastDate)
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
  const nameOf = u => u.split('/').pop()
  const replyUrls = replyFilesOf(inner)
  const likeUrls = inner.filter(u => u.endsWith('.jsonld') && nameOf(u).startsWith('like_'))

  const myId = currentIdentity()?.id
  const likeDocs = (await Promise.all(likeUrls.map(loadJson))).filter(Boolean)
  const tally = {}
  for (const l of likeDocs) {
    const tgt = l['schema:object'] || l.object
    if (!tgt) continue
    const e = tally[tgt] || (tally[tgt] = { count: 0, mine: false })
    e.count++
    if (myId && (l['schema:agent'] || l.agent) === myId) e.mine = true
  }
  const likeInfo = id => ({ likeCount: tally[id]?.count || 0, likedByMe: !!tally[id]?.mine })

  const replies = (await Promise.all(replyUrls.map(async u => {
    const d = await loadJson(u)
    if (!d) return null
    const id = nameOf(u).replace(/\.jsonld$/, '')
    return {
      id, url: u,
      author: displayName(d['schema:author'] || d.author),
      authorId: d['schema:author'] || d.author || '',
      text: d['schema:text'] || d.text || '',
      date: d['schema:datePublished'] || d.datePublished || '',
      when: relTime(d['schema:datePublished'] || d.datePublished),
      edited: !!(d['schema:dateModified'] || d.dateModified),
      ...likeInfo(id)
    }
  }))).filter(Boolean).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const op = {
    id: 'op', url: `${dir}topic.jsonld`,
    author: displayName(meta['schema:author']),
    authorId: meta['schema:author'] || '',
    text: meta['schema:text'] || '',
    when: relTime(meta['schema:datePublished']),
    date: meta['schema:datePublished'] || '',
    edited: !!(meta['schema:dateModified']),
    ...likeInfo('op')
  }
  return {
    id: topicId, catId,
    title: meta['schema:headline'] || '(untitled)',
    pinned: !!meta['discuss:pinned'],
    posts: [op, ...replies]
  }
}

async function toggleLike(catId, topicId, target, liked) {
  const id = currentIdentity()
  if (!id) throw new Error('not signed in')
  const url = `${CATS_BASE}${encodeURIComponent(catId)}/${encodeURIComponent(topicId)}/like_${target}_${slug(id.id)}.jsonld`
  if (liked) {
    await deleteResource(url)
  } else {
    await put(url, {
      '@context': CTX, '@type': 'schema:LikeAction',
      'schema:agent': id.id, 'schema:object': target,
      'schema:datePublished': new Date().toISOString()
    })
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

// edit a post in place (preserves author/date, stamps dateModified)
async function savePost(url, fields) {
  const doc = (await loadJson(url))
  if (!doc) throw new Error('post not found')
  Object.assign(doc, fields, { 'schema:dateModified': new Date().toISOString() })
  await put(url, doc)
}

// delete a whole topic: remove every file in its container, then the container
async function deleteTopic(catId, topicId) {
  const dir = `${CATS_BASE}${encodeURIComponent(catId)}/${encodeURIComponent(topicId)}/`
  const inner = (await listContainer(dir).catch(() => [])) || []
  for (const u of inner) {
    if (u.replace(/\/$/, '') !== dir.replace(/\/$/, '')) await deleteResource(u).catch(() => {})
  }
  await deleteResource(dir).catch(() => {})
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
function categoryForm({ name = '', color = '#4f46e5', description = '' } = {}, onSave, onCancel) {
  const form = el(`
    <div class="catform">
      <div class="catform-row">
        <input class="cf-color" type="color" value="${esc(color)}" title="Category colour">
        <input class="cf-name" type="text" placeholder="Category name" maxlength="60" value="${esc(name)}">
      </div>
      <input class="cf-desc" type="text" placeholder="Short description" maxlength="160" value="${esc(description)}">
      <div class="compose-bar">
        <button class="btn cf-save">Save</button>
        <button class="btn btn-ghost cf-cancel">Cancel</button>
      </div>
    </div>`)
  form.querySelector('.cf-cancel').addEventListener('click', onCancel)
  form.querySelector('.cf-save').addEventListener('click', async () => {
    const name = form.querySelector('.cf-name').value.trim()
    if (!name) { form.querySelector('.cf-name').focus(); return }
    const data = {
      name, color: form.querySelector('.cf-color').value,
      description: form.querySelector('.cf-desc').value.trim()
    }
    const save = form.querySelector('.cf-save'); save.disabled = true; save.textContent = 'Saving…'
    try { await onSave(data) } catch (e) { toast('Save failed: ' + e.message); save.disabled = false; save.textContent = 'Save' }
  })
  return form
}

async function renderCategories(token) {
  setCrumbs([{ label: 'Categories' }])
  showLoading('categories')
  const cats = state.categories || []
  const counts = await Promise.all(cats.map(async c => {
    if (state.demo) {
      const s = SAMPLE.categories.find(x => x.id === c.id)
      return s ? s.topics.length : 0
    }
    const entries = await listContainer(`${CATS_BASE}${encodeURIComponent(c.id)}/`).catch(() => null)
    return entries ? entries.filter(u => u.endsWith('/')).length : 0
  }))
  if (token !== renderToken) return

  const canManage = !!currentIdentity()
  app.innerHTML = ''
  app.appendChild(el(demoNotice() || '<span></span>'))
  app.appendChild(el(`
    <div class="page-head">
      <h1>Categories</h1>
      <p>Pick a place to read or start a discussion.</p>
      <span class="spacer"></span>
      <button class="btn" id="new-cat" ${canManage ? '' : 'disabled title="Sign in to manage categories"'}>+ New category</button>
    </div>`))

  const newCatSlot = el('<div></div>')
  app.appendChild(newCatSlot)
  if (canManage) {
    document.getElementById('new-cat').addEventListener('click', () => {
      if (newCatSlot.firstChild) { newCatSlot.innerHTML = ''; return }
      newCatSlot.appendChild(categoryForm({}, async data => {
        const id = await addCategory(data)
        resetData(); await render(); toast('Category added')
        location.hash = `#/${encodeURIComponent(id)}`
      }, () => { newCatSlot.innerHTML = '' }))
      newCatSlot.querySelector('.cf-name').focus()
    })
  }

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
        ${canManage ? '<button class="icon-btn cat-edit" title="Edit category">✎</button>' : ''}
      </div>`)
    const go = () => { location.hash = `#/${encodeURIComponent(cat.id)}` }
    row.addEventListener('click', e => { if (!e.target.closest('.cat-edit') && !e.target.closest('.catform')) go() })
    row.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
    const editBtn = row.querySelector('.cat-edit')
    if (editBtn) {
      editBtn.addEventListener('click', e => {
        e.stopPropagation()
        if (row.querySelector('.catform')) { render(); return }
        const form = categoryForm(cat, async data => {
          await updateCategory(cat.id, data)
          resetData(); await render(); toast('Category updated')
        }, () => render())
        row.appendChild(form)
        form.querySelector('.cf-name').focus()
      })
    }
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
  topics.sort((a, b) => (b.pinned - a.pinned) || (b.lastDate || '').localeCompare(a.lastDate || ''))

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

  const form = el(`
    <div class="newtopic" hidden>
      <input class="nt-title" type="text" placeholder="Topic title" maxlength="140">
      <textarea class="nt-body" placeholder="Write the first post…  (markdown supported)"></textarea>
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
          s.topics.unshift({ id: tid, title, pinned: false, author: 'me', when: 'just now', replyCount: 0, date: '',
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
    const seen = seenCount(catId, t.id)
    let badge = ''
    if (seen === undefined) badge = '<span class="new-pill">new</span>'
    else if (t.replyCount > seen) badge = `<span class="new-pill">${t.replyCount - seen} new</span>`
    const row = el(`
      <div class="row" role="link" tabindex="0">
        <div class="topic-main">
          <div class="topic-title">${t.pinned ? '📌 ' : ''}${esc(t.title)} ${badge}</div>
          <div class="topic-sub">
            <span class="pill">${esc(cat.name)}</span>
            <span>by ${esc(t.author)}</span>
          </div>
        </div>
        <div class="topic-stat"><div class="n">${t.replyCount}</div><div class="l">replies</div></div>
        <div class="topic-when">${esc(t.lastWhen)}${t.lastAuthor ? `<span class="lastby">${esc(t.lastAuthor)}</span>` : ''}</div>
      </div>`)
    const go = () => { location.hash = `#/${encodeURIComponent(catId)}/${encodeURIComponent(t.id)}` }
    row.addEventListener('click', go)
    row.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
    list.appendChild(row)
  }
  app.appendChild(list)
}

// ---------------------------------------------------------------- view: topic
function quoteInto(author, text) {
  const ta = document.getElementById('reply-input')
  if (!ta) { toast('Sign in to reply'); return }
  const quoted = String(text).split('\n').slice(0, 12).map(l => `> ${l}`).join('\n')
  const block = `> **@${author}** wrote:\n${quoted}\n\n`
  ta.value = (ta.value ? ta.value.replace(/\s*$/, '') + '\n\n' : '') + block
  ta.focus()
  ta.scrollIntoView({ behavior: 'smooth', block: 'center' })
  try { ta.setSelectionRange(ta.value.length, ta.value.length) } catch {}
}

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

  const myId = currentIdentity()?.id
  topic.posts.forEach((p, i) => {
    const isOp = i === 0
    const mine = !state.demo && myId && p.authorId && p.authorId === myId
    const acts = [`<button class="like${p.likedByMe ? ' liked' : ''}" data-act="like" title="Like">♥ <span class="like-n">${p.likeCount || ''}</span></button>`]
    if (myId) acts.push('<button class="pact" data-act="quote">Quote</button>')
    if (mine) {
      acts.push('<button class="pact" data-act="edit">Edit</button>')
      acts.push(`<button class="pact danger" data-act="del">${isOp ? 'Delete topic' : 'Delete'}</button>`)
    }
    const post = el(`
      <div class="post${isOp ? ' op' : ''}">
        <div class="avatar" style="background:${avatarColor(p.author)}">${esc((p.author[0] || '?').toUpperCase())}</div>
        <div class="post-body">
          <div class="post-head">
            <span class="post-author">${esc(p.author)}</span>
            <span class="post-when">${esc(p.when)}</span>
            ${p.edited ? '<span class="edited">· edited</span>' : ''}
            ${p.unsaved ? '<span class="unsaved">unsaved</span>' : ''}
          </div>
          <div class="post-text">${renderMarkdown(p.text)}</div>
          <div class="post-actions">${acts.join('')}</div>
        </div>
      </div>`)
    post.querySelector('.post-actions').addEventListener('click', e => {
      const btn = e.target.closest('[data-act]'); if (!btn) return
      const act = btn.dataset.act
      if (act === 'like') return doLike(p, btn, cat, topic)
      if (act === 'quote') return quoteInto(p.author, p.text)
      if (act === 'edit') return startEdit(post, p, isOp, cat, topic)
      if (act === 'del') return doDelete(p, isOp, cat, topic)
    })
    app.appendChild(post)
  })

  markSeen(catId, topicId, topic.posts.length - 1)
  app.appendChild(buildCompose(cat, topic))
}

async function doLike(p, btn, cat, topic) {
  if (!currentIdentity()) { toast('Sign in to like'); return }
  btn.disabled = true
  try {
    if (state.demo) {
      p.likedByMe = !p.likedByMe
      p.likeCount = Math.max(0, (p.likeCount || 0) + (p.likedByMe ? 1 : -1))
      await render()
    } else {
      await toggleLike(cat.id, topic.id, p.id, p.likedByMe)
      await render()
    }
  } catch (e) { toast('Like failed: ' + e.message); btn.disabled = false }
}

function startEdit(post, p, isOp, cat, topic) {
  const textEl = post.querySelector('.post-text')
  const actionsEl = post.querySelector('.post-actions')
  const form = el(`
    <div class="post-edit">
      ${isOp ? `<input class="pe-title" type="text" maxlength="140">` : ''}
      <textarea class="pe-body"></textarea>
      <div class="compose-bar">
        <button class="btn pe-save">Save</button>
        <button class="btn btn-ghost pe-cancel">Cancel</button>
      </div>
    </div>`)
  if (isOp) form.querySelector('.pe-title').value = topic.title
  form.querySelector('.pe-body').value = p.text
  textEl.style.display = 'none'
  actionsEl.style.display = 'none'
  textEl.after(form)
  form.querySelector('.pe-body').focus()
  form.querySelector('.pe-cancel').addEventListener('click', () => render())
  form.querySelector('.pe-save').addEventListener('click', async () => {
    const body = form.querySelector('.pe-body').value.trim()
    const save = form.querySelector('.pe-save'); save.disabled = true; save.textContent = 'Saving…'
    try {
      if (isOp) {
        const title = form.querySelector('.pe-title').value.trim() || topic.title
        await savePost(p.url, { 'schema:headline': title, 'schema:text': body })
      } else {
        await savePost(p.url, { 'schema:text': body })
      }
      await render(); toast('Saved')
    } catch (e) { toast('Save failed: ' + e.message); save.disabled = false; save.textContent = 'Save' }
  })
}

async function doDelete(p, isOp, cat, topic) {
  if (isOp) {
    if (!confirm('Delete this whole topic and all its replies? This cannot be undone.')) return
    try {
      await deleteTopic(cat.id, topic.id)
      toast('Topic deleted')
      location.hash = `#/${encodeURIComponent(cat.id)}`
    } catch (e) { toast('Delete failed: ' + e.message) }
  } else {
    if (!confirm('Delete this reply?')) return
    try {
      await deleteResource(p.url)
      await render(); toast('Reply deleted')
    } catch (e) { toast('Delete failed: ' + e.message) }
  }
}

// reply composer — persists to the pod (or appends in-memory in demo)
function buildCompose(cat, topic) {
  const id = currentIdentity()
  const box = el(`
    <div class="compose">
      <textarea id="reply-input" placeholder="${id ? 'Write a reply…  (markdown · ⌘/Ctrl+Enter to post)' : 'Sign in to reply…'}"${id ? '' : ' disabled'}></textarea>
      <div class="compose-bar">
        <button class="btn" ${id ? '' : 'disabled'}>Post reply</button>
        <span class="cat-desc">${id ? (state.demo ? 'Demo — replies are in-memory only.' : 'Saved to the pod as JSON-LD. Markdown supported.') : 'Sign in (top-right) to join the discussion.'}</span>
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
        await render()
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
  document.addEventListener('xlogin', reload)
  document.addEventListener('xlogout', reload)
}

let reloadChain = Promise.resolve()
function reload() {
  reloadChain = reloadChain.then(doReload, doReload)
  return reloadChain
}
async function doReload() {
  refreshAccount()
  await resolvePod()
  resetData()
  await render()
}

// ----------------------------------------------------------------- bootstrap
window.addEventListener('hashchange', render)
wireSignIn();
(async () => {
  try { if (window.xlogin && window.xlogin.ready) await window.xlogin.ready } catch {}
  reload()
})()
