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

```
/public/discuss/index.jsonld                     forum meta + category list
/public/discuss/c/<cat>/<topicId>/topic.jsonld   the opening post
/public/discuss/c/<cat>/<topicId>/<postId>.jsonld one file per reply (append-only)
/public/discuss/.acl                             owner Control; AuthenticatedAgent Append
```

One file per reply means many people can post concurrently without overwriting each
other — the container just collects everyone's docs.

## Status

MVP, built in phases. Checkpoints:

- [x] **1. Scaffold** — light-theme Discourse layout, three views (Categories → Topics →
  Topic thread) over hardcoded sample data, hash router.
- [ ] **2. Auth** — xlogin wired up; header shows identity; compose box enabled.
- [ ] **3. Categories** — read/write `/public/discuss/index.jsonld` + seed `.acl`.
- [ ] **4. Topics** — per-category container; list + create topics.
- [ ] **5. Replies** — topic thread reads reply docs; compose appends a JSON-LD post.
- [ ] **6. Polish** — likes, relative activity times, new/unread badges.

## Run

Static — open `index.html`, or install to a pod (e.g. `/public/apps/discuss/`). The app
data (`/public/discuss/`) is independent of where the app code is installed.

## License

[AGPL-3.0-or-later](./LICENSE)
