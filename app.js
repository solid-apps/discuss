// discuss — a Discourse-style forum on your Solid pod.
//
// Phase 1 (this file): static scaffold. Three views — Categories, Topic list,
// Topic thread — driven by hardcoded SAMPLE data and a tiny hash router. No
// auth, no pod I/O yet. Later phases swap SAMPLE for live JSON-LD on the pod.
//
// Planned data layout (same-origin as the app), wired in later phases:
//   /public/discuss/index.jsonld                  forum meta + category list
//   /public/discuss/c/<cat>/<topicId>/topic.jsonld  the opening post
//   /public/discuss/c/<cat>/<topicId>/<postId>.jsonld  one file per reply

// ---------------------------------------------------------------- sample data
const SAMPLE = {
  categories: [
    {
      id: 'announcements', name: 'Announcements', color: '#e11d48',
      description: 'Releases, news, and anything the team wants everyone to see.',
      topics: [
        {
          id: 'welcome', title: 'Welcome to discuss 👋', pinned: true,
          author: 'melvin', when: '2d', replyCount: 4, views: 128,
          posts: [
            { author: 'melvin', when: '2 days ago', text: "This is a Discourse-style forum that lives entirely on your Solid pod.\n\nCategories hold topics, topics hold a thread of replies — all stored as JSON-LD you own. Right now you're looking at sample data; sign-in and live data land in the next phases." },
            { author: 'ana', when: '2 days ago', text: 'Love that it’s just static files on the pod. No server, no database.' },
            { author: 'kenji', when: '1 day ago', text: 'Will replies be one file each so multiple people can post without clobbering?' },
            { author: 'melvin', when: '1 day ago', text: 'Exactly — append-only, one JSON-LD doc per reply. That’s Phase 5.' },
            { author: 'priya', when: '6h', text: 'Following. The breadcrumb nav already feels right.' }
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
          author: 'ana', when: '5h', replyCount: 2, views: 41,
          posts: [
            { author: 'ana', when: '5 hours ago', text: 'Hi all — building decentralized social stuff. Glad to be here.' },
            { author: 'sam', when: '3 hours ago', text: 'Welcome! Same boat. What pod provider are you on?' },
            { author: 'ana', when: '1 hour ago', text: 'Self-hosted JSS on a little box at home.' }
          ]
        },
        {
          id: 'favourite-pod-apps', title: 'What are your favourite Solid pod apps?', pinned: false,
          author: 'kenji', when: '1d', replyCount: 1, views: 73,
          posts: [
            { author: 'kenji', when: '1 day ago', text: 'Curious what everyone keeps installed. I live in the journal and tasks apps.' },
            { author: 'priya', when: '20h', text: 'markmap for thinking, contacts for everything else.' }
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
          author: 'sam', when: '3d', replyCount: 1, views: 55,
          posts: [
            { author: 'sam', when: '3 days ago', text: 'I PUT an .acl with acl:default on the parent but child docs still 403 for other users. What am I missing?' },
            { author: 'melvin', when: '3 days ago', text: 'Make sure acl:default points at "./" (the container) and the agent class is acl:AuthenticatedAgent, not a specific WebID.' }
          ]
        }
      ]
    }
  ]
}

// ----------------------------------------------------------------- tiny utils
const app = document.getElementById('app')
const crumbsEl = document.getElementById('crumbs')

function el(html) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// deterministic avatar colour from a name
function avatarColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 52%, 52%)`
}

// ---------------------------------------------------------------- identity
// xlogin gives us window.xlogin.{id, type, authFetch, login, logout, ready}.
function currentIdentity() {
  if (!window.xlogin || !window.xlogin.id) return null
  return { type: window.xlogin.type, id: window.xlogin.id }
}

// short, human label for a WebID URL or a nostr key
function displayName(id, type) {
  if (!id) return 'me'
  if (type === 'nostr') return id.length > 14 ? id.slice(0, 10) + '…' : id
  try {
    const u = new URL(id)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    return (seg || u.hostname).replace(/#.*$/, '')
  } catch { return id }
}

// authenticated fetch when signed in, plain fetch otherwise (used from Phase 3 on)
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
  t._tid = setTimeout(() => t.classList.remove('show'), 2200)
}

const findCategory = id => SAMPLE.categories.find(c => c.id === id)
const findTopic = (cat, id) => cat && cat.topics.find(t => t.id === id)

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
    if (it.href) {
      crumbsEl.appendChild(el(`<a href="${it.href}">${esc(it.label)}</a>`))
    } else {
      crumbsEl.appendChild(el(`<span class="here">${esc(it.label)}</span>`))
    }
  })
}

function render() {
  const route = parseHash()
  if (route.view === 'topics') return renderTopics(route.cat)
  if (route.view === 'topic') return renderTopic(route.cat, route.topic)
  return renderCategories()
}

// ----------------------------------------------------------------- view: cats
function renderCategories() {
  setCrumbs([{ label: 'Categories' }])
  app.innerHTML = ''
  app.appendChild(el(`
    <div class="page-head">
      <h1>Categories</h1>
      <p>Pick a place to read or start a discussion.</p>
    </div>`))

  const list = el('<div class="list"></div>')
  for (const cat of SAMPLE.categories) {
    const topicCount = cat.topics.length
    const postCount = cat.topics.reduce((n, t) => n + t.posts.length, 0)
    const row = el(`
      <div class="row" role="link" tabindex="0">
        <span class="cat-badge" style="background:${cat.color}"></span>
        <div class="cat-body">
          <div class="cat-title">${esc(cat.name)}</div>
          <div class="cat-desc">${esc(cat.description)}</div>
        </div>
        <div class="cat-meta"><b>${topicCount}</b> topics<br>${postCount} posts</div>
      </div>`)
    const go = () => { location.hash = `#/${encodeURIComponent(cat.id)}` }
    row.addEventListener('click', go)
    row.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
    list.appendChild(row)
  }
  app.appendChild(list)
}

// --------------------------------------------------------------- view: topics
function renderTopics(catId) {
  const cat = findCategory(catId)
  if (!cat) return renderMissing('Category not found')
  setCrumbs([{ label: 'Categories', href: '#/' }, { label: cat.name }])
  app.innerHTML = ''
  app.appendChild(el(`
    <div class="page-head">
      <span class="cat-badge" style="background:${cat.color};width:14px;height:22px;border-radius:5px"></span>
      <h1>${esc(cat.name)}</h1>
      <span class="spacer"></span>
      <button class="btn" id="new-topic" disabled title="Sign-in &amp; posting land in a later phase">+ New topic</button>
    </div>`))
  app.appendChild(el(`<div class="cat-desc" style="margin:-8px 0 18px">${esc(cat.description)}</div>`))

  const list = el('<div class="list"></div>')
  const topics = [...cat.topics].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
  for (const t of topics) {
    const row = el(`
      <div class="row" role="link" tabindex="0">
        <div class="topic-main">
          <div class="topic-title">${t.pinned ? '📌 ' : ''}${esc(t.title)}</div>
          <div class="topic-sub">
            <span class="pill">${esc(cat.name)}</span>
            <span>by ${esc(t.author)}</span>
            <span>· ${t.views} views</span>
          </div>
        </div>
        <div class="topic-stat"><div class="n">${t.replyCount}</div><div class="l">replies</div></div>
        <div class="topic-when">${esc(t.when)}</div>
      </div>`)
    const go = () => { location.hash = `#/${encodeURIComponent(cat.id)}/${encodeURIComponent(t.id)}` }
    row.addEventListener('click', go)
    row.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
    list.appendChild(row)
  }
  app.appendChild(list)
}

// ---------------------------------------------------------------- view: topic
function renderTopic(catId, topicId) {
  const cat = findCategory(catId)
  const topic = findTopic(cat, topicId)
  if (!cat || !topic) return renderMissing('Topic not found')
  setCrumbs([
    { label: 'Categories', href: '#/' },
    { label: cat.name, href: `#/${encodeURIComponent(cat.id)}` },
    { label: topic.title }
  ])
  app.innerHTML = ''
  app.appendChild(el(`
    <div class="thread-head">
      <h1>${t_pin(topic)}${esc(topic.title)}</h1>
      <div class="meta">in <a href="#/${encodeURIComponent(cat.id)}">${esc(cat.name)}</a>
        · ${topic.posts.length} posts · ${topic.views} views</div>
    </div>`))

  topic.posts.forEach((p, i) => {
    const post = el(`
      <div class="post${i === 0 ? ' op' : ''}">
        <div class="avatar" style="background:${avatarColor(p.author)}">${esc(p.author[0].toUpperCase())}</div>
        <div class="post-body">
          <div class="post-head">
            <span class="post-author">${esc(p.author)}</span>
            <span class="post-when">${esc(p.when)}</span>
            ${p.unsaved ? '<span class="unsaved">unsaved</span>' : ''}
          </div>
          <div class="post-text">${esc(p.text)}</div>
        </div>
      </div>`)
    app.appendChild(post)
  })

  app.appendChild(buildCompose(topic))
}

// compose box — enabled when signed in. Posting appends to the in-memory thread
// (Phase 2). Persisting to the pod as JSON-LD lands in Phase 5.
function buildCompose(topic) {
  const id = currentIdentity()
  const box = el(`
    <div class="compose">
      <textarea placeholder="${id ? 'Write a reply…' : 'Sign in to reply…'}"${id ? '' : ' disabled'}></textarea>
      <div class="compose-bar">
        <button class="btn" ${id ? '' : 'disabled'}>Post reply</button>
        <span class="cat-desc">${id ? 'Stored in-memory for now — saving to your pod lands in Phase 5.' : 'Sign in (top-right) to join the discussion.'}</span>
      </div>
    </div>`)
  if (!id) return box
  const ta = box.querySelector('textarea')
  const btn = box.querySelector('button')
  const submit = () => {
    const text = ta.value.trim()
    if (!text) return
    topic.posts.push({
      author: displayName(id.id, id.type), when: 'just now', text, unsaved: true
    })
    topic.replyCount = topic.posts.length - 1
    render() // re-render the thread with the new post
    toast('Reply added (not yet saved to pod)')
  }
  btn.addEventListener('click', submit)
  ta.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
  })
  return box
}

const t_pin = t => (t.pinned ? '📌 ' : '')

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
    const name = displayName(id.id, id.type)
    signinBtn.hidden = true
    account.hidden = false
    const av = document.getElementById('me-avatar')
    av.textContent = name[0].toUpperCase()
    av.style.background = avatarColor(name)
    document.getElementById('me-name').textContent = name
    document.getElementById('me-name').title = id.id
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
  // xlogin fires these on `document` when the session changes.
  document.addEventListener('xlogin', () => { refreshAccount(); render() })
  document.addEventListener('xlogout', () => { refreshAccount(); render() })
}

// ----------------------------------------------------------------- bootstrap
window.addEventListener('hashchange', render)
wireSignIn();
(async () => {
  try { if (window.xlogin && window.xlogin.ready) await window.xlogin.ready } catch {}
  refreshAccount()
  render()
})()
