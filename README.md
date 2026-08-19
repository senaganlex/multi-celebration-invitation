# Multi-Celebration Invitation

A single-file interactive invitation frontend deployed with GitHub Pages, backed by a small Railway API and PostgreSQL RSVP database.

## Event

**Saturday, August 22, 2026**  
Beside **Melcar Refilling Station, Looc, Oslob**  
Coordinates: **9.542456, 123.445854**

### Graduation Celebration
- Lex Mariun Señagan — Computer Engineer
- Lexter Jay Señagan — Electrical Engineer

### Birthday Celebration
- Edwin Señagan
- Lexter Jay Señagan
- Lex Luther Señagan

## Repository layout

```text
.
├── docs/
│   └── index.html       # Entire public frontend: HTML + CSS + JavaScript
├── server.js            # Railway REST API
├── package.json
├── schema.sql           # Optional manual schema
├── .env.example
└── .gitignore
```

## Frontend behavior

- Responsive single-page invitation
- Animated hero and celebration cards
- Live countdown to August 22, 2026
- Exact location map and map/directions buttons
- RSVP modal with Attend / Decline choices
- Party size and optional companion names
- Optional message
- RSVP updates from the same browser/device
- Live aggregate attendance count only
- No public guest list
- Reduced-motion accessibility support
- Keyboard-accessible modal
- Confetti only after an attending RSVP

## RSVP security model

The browser never receives database credentials.

When an RSVP is created:

1. The API generates a random RSVP UUID.
2. The API generates a 256-bit edit token.
3. Only a SHA-256 hash of the edit token is stored in PostgreSQL.
4. The browser stores the RSVP ID and edit token in `localStorage`.
5. Updates require both the RSVP ID and the secret edit token.
6. The public stats endpoint returns aggregate totals only.

This is deliberately lightweight. It prevents casual modification of another guest's RSVP without requiring user accounts.

## 1. Create Railway PostgreSQL

Create a PostgreSQL service in the Railway project and make its `DATABASE_URL` available to the API service.

The API automatically creates the required table and index on startup, so running `schema.sql` manually is optional.

## 2. Deploy the API on Railway

Deploy this repository as a Railway service.

Required variables:

```env
DATABASE_URL=<Railway PostgreSQL connection URL>
ALLOWED_ORIGINS=https://YOUR-GITHUB-USERNAME.github.io
NODE_ENV=production
```

If the GitHub Pages site uses a custom domain, add it too:

```env
ALLOWED_ORIGINS=https://YOUR-GITHUB-USERNAME.github.io,https://invite.example.com
```

Do not include trailing slashes.

The API exposes:

```text
GET  /health
GET  /api/rsvps/stats
POST /api/rsvps
GET  /api/rsvps/:id
PUT  /api/rsvps/:id
```

There is intentionally no public endpoint that lists guest names.

## 3. Configure the frontend

Open:

```text
docs/index.html
```

Find:

```js
const API_BASE = "https://YOUR-RAILWAY-API-DOMAIN.up.railway.app";
```

Replace it with the actual public HTTPS domain of your Railway API.

Example:

```js
const API_BASE = "https://multi-celebration-api-production.up.railway.app";
```

Do not add a trailing slash.

## 4. Enable GitHub Pages

Configure GitHub Pages to publish from the repository's `docs` folder.

The frontend is completely self-contained in `docs/index.html`.

## 5. Validate

### API

```bash
npm install
npm run check
npm start
```

Health check:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{"ok":true}
```

### Browser

Verify:

- Page works on desktop and mobile widths.
- Countdown updates every second.
- Map opens the correct coordinates.
- First RSVP creates a response.
- Reloading the same browser allows that response to be edited.
- Declining hides/disables party fields.
- `/api/rsvps/stats` changes after RSVP submission.
- Guest names/messages are never exposed by the stats endpoint.

## Notes

- The event time was not specified, so the countdown currently targets **12:00 AM Philippine time on August 22, 2026**. Change `EVENT_DATE` in `docs/index.html` after the exact event time is known.
- RSVP edit access is tied to the browser's local storage. Clearing browser storage removes the local edit token, although the RSVP remains in PostgreSQL.
- For a private administrator dashboard later, add authenticated admin endpoints rather than exposing the RSVP table publicly.
