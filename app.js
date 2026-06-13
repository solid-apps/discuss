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
          </div>
          <div class="post-text">${esc(p.text)}</div>
        </div>
      </div>`)
    app.appendChild(post)
  })

  // compose box — visible but disabled until auth/posting phases
  app.appendChild(el(`
    <div class="compose">
      <textarea placeholder="Replying is enabled once sign-in &amp; posting land (Phase 2–5)…" disabled></textarea>
      <div class="compose-bar">
        <button class="btn" disabled>Post reply</button>
        <span class="cat-desc">Read-only scaffold — your reply will save as JSON-LD on the pod.</span>
      </div>
    </div>`))
}

const t_pin = t => (t.pinned ? '📌 ' : '')

function renderMissing(msg) {
  setCrumbs([{ label: 'Categories', href: '#/' }, { label: 'Not found' }])
  app.innerHTML = ''
  app.appendChild(el(`<div class="notice">${esc(msg)}. <a href="#/">Back to categories</a>.</div>`))
}

// ----------------------------------------------------- sign-in (placeholder)
function wireSignIn() {
  const btn = document.getElementById('signin')
  const idEl = document.getElementById('topbar-id')
  function refresh() {
    if (window.xlogin && window.xlogin.id) {
      btn.hidden = true
      idEl.hidden = false
      idEl.textContent = window.xlogin.id
    } else {
      btn.hidden = false
      idEl.hidden = true
    }
  }
  btn.addEventListener('click', () => {
    if (window.xlogin && window.xlogin.login) window.xlogin.login()
    else alert('Sign-in wiring lands in Phase 2. This scaffold is read-only sample data.')
  })
  // xlogin may fire an event when ready/changed; refresh defensively too.
  window.addEventListener('xlogin', refresh)
  refresh()
}

// ----------------------------------------------------------------- bootstrap
window.addEventListener('hashchange', render)
wireSignIn()
render()
