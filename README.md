# PizzaHub (Server)

Express and MongoDB API for the PizzaHub pizza ordering platform.

- **Client repo:** [client GitHub URL]
- **Live API:** [server live URL]

## Tech stack

Node.js, Express (ES modules), MongoDB (native driver), jose (JWT verification), Stripe.

## Getting started

```bash
npm install
npm run dev
```

Create `.env`:


PORT=5000
CLIENT_URL=http://localhost:3000
AUTH_URL=http://localhost:3000
MONGODB_URI=your_mongodb_connection_string
DB_NAME=your_database_name
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Make an existing account an admin:

npm run make-admin -- user@example.com


## API overview

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/menu-items` | Public | Approved items with search, filters, sort, pagination |
| `GET /api/menu-items/featured`, `/filters` | Public | Home page items and filter options |
| `GET /api/menu-items/:id` | Logged in | Item details |
| `POST /api/menu-items` | Vendor | Add item (free plan: max 3 active) |
| `GET /api/menu-items/mine` | Vendor | Own items |
| `PATCH /api/menu-items/:id`, `/availability` | Vendor | Edit item, make available or unavailable |
| `DELETE /api/menu-items/:id` | Vendor | Delete item |
| `POST /api/orders` | Customer | Place order |
| `GET /api/orders/mine` | Customer | Own orders |
| `PATCH /api/orders/:id/cancel` | Customer | Cancel pending order |
| `GET /api/orders/vendor` | Vendor | Orders for own items |
| `PATCH /api/orders/:id/status` | Vendor | Accept or reject (once) |
| `GET /api/stats/vendor` | Vendor | Dashboard numbers |
| `POST /api/payments/checkout` | Vendor | Start Stripe Checkout |
| `POST /api/payments/webhook` | Stripe | Verified payment event, activates Premium |
| `GET /api/admin/stats`, `/users`, `/menu-items`, `/transactions` | Admin | Dashboard data |
| `PATCH /api/admin/users/:id/block` | Admin | Block or unblock a user |
| `PATCH /api/admin/menu-items/:id/status` | Admin | Approve, reject, deactivate, activate |
| `DELETE /api/admin/menu-items/:id` | Admin | Delete item |

## Business rules

- Only approved items are public. Editing an approved or rejected item sends it back to pending.
- A vendor can make their own approved item unavailable. An item deactivated by an admin can be activated only by an admin.
- Customers cannot order their own items, and cannot place a second active order for the same item and delivery date.
- A vendor can accept or reject a pending order only once.
- Blocked users get `403` on every protected route.

## Authentication middleware

`verifyJWT` reads the Bearer token, verifies it with the Better Auth JWKS (`jose`), loads the user from the database and attaches it to `req.user`. `verifyRole(...roles)` then checks `req.user.role`