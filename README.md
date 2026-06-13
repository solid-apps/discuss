# discuss

A **Discourse-style forum** for [Solid](https://solidproject.org) pods — categories,
topics, and threaded replies, stored as JSON-LD you own. One self-contained app, no
build step.

Sister to [`forum`](https://github.com/solid-apps/forum) (which is *Discord*-style —
realtime chat channels). `discuss` is the long-form, threaded side: read a category,
open a topic, follow the thread.

Sign in with [xlogin](https://github.com/solid-apps) — Solid-OIDC (WebID) **or** nostr.

## Data model

Shared-pod, multi-user: one pod hosts the forum, any authenticated user can post.
The forum lives on the **signed-in user's** pod — resolved from the WebID's
`pim:storage` (falling back to the WebID origin) — so the app works whether it's
served from the pod itself or from somewhere else (e.g. github.io).

```
/public/discuss/index.jsonld                     forum meta + category list
/public/discuss/c/<cat>/<topicId>/topic.jsonld   the opening post
/public/discuss/c/<cat>/<topicId>/<postId>.jsonld one file per reply (append-only)
/public/discuss/c/<cat>/<topicId>/like_<target>_<user>.jsonld  one file per like
/public/discuss/.acl                             owner Control; AuthenticatedAgent Append
```

One file per reply means many people can post concurrently without overwriting each
other — the container just collects everyone's docs.

## Status

MVP complete — full read/write on a pod. Built in phases:

- [x] **1. Scaffold** — light-theme Discourse layout, three views (Categories → Topics →
  Topic thread) over hardcoded sample data, hash router.
- [x] **2. Auth** — xlogin wired up; header shows identity (avatar + name + sign-out).
- [x] **3. Categories** — categories read from `/public/discuss/index.jsonld`; a fresh
  forum is seeded (index + `.acl` + a welcome topic) on the owner's first visit. Opened
  without a writable pod (e.g. github.io, signed out) it falls back to a read-only demo.
- [x] **4. Topics** — per-category container; topic list + inline **New topic** form that
  PUTs `c/<cat>/<topicId>/topic.jsonld`.
- [x] **5. Replies** — topic thread reads every reply doc in the container and renders them
  chronologically; the composer PUTs one JSON-LD `schema:Comment` per reply (append-only).
- [x] **6. Polish** — relative activity times; per-post **likes** (append-only
  `schema:LikeAction` docs, one file per user per post, toggle = PUT/DELETE);
  **new/unread** badges on the topic list (tracked in `localStorage` by reply count,
  no extra fetches).

## Run

Static — open `index.html`, or install to a pod (e.g. `/public/apps/discuss/`). The app
data (`/public/discuss/`) is independent of where the app code is installed.

## License

[AGPL-3.0-or-later](./LICENSE)
