# Aqua Fishing Academy ERP — Backend (Phase 1: Project Foundation)

Node.js + Express + MongoDB (Mongoose) backend implementing the Phase 1 scope:

- Project architecture and system setup
- Database design and structure
- User authentication system (JWT access + refresh tokens, httpOnly cookie)
- Role-based access control (RBAC)
- User management and permissions
- Core system configuration
- Security foundation (Helmet, rate limiting, sanitization, bcrypt, account lockout)
- Basic application framework setup

## Tech Stack

- Node.js / Express 4
- MongoDB / Mongoose 8
- JWT authentication (access + refresh)
- bcryptjs, helmet, express-rate-limit, express-mongo-sanitize, xss-clean
- express-validator

## Folder Structure

```
backend/
├── server.js                 # App entry point
├── .env.example               # Environment variable template
└── src/
    ├── app.js                 # Express app & middleware pipeline
    ├── config/
    │   ├── config.js           # Central config reader
    │   ├── db.js                # MongoDB connection
    │   └── rbac.constants.js    # Permission & default role definitions
    ├── models/
    │   ├── User.js
    │   └── Role.js
    ├── controllers/
    │   ├── authController.js
    │   ├── userController.js
    │   └── roleController.js
    ├── routes/
    │   ├── index.js
    │   ├── authRoutes.js
    │   ├── userRoutes.js
    │   └── roleRoutes.js
    ├── middleware/
    │   ├── auth.js              # JWT "protect" middleware
    │   ├── rbac.js               # requirePermission / requireRole
    │   ├── validate.js           # express-validator error formatter
    │   └── errorHandler.js       # Global error handler
    ├── utils/
    │   ├── appError.js
    │   ├── catchAsync.js
    │   ├── apiResponse.js
    │   └── generateTokens.js
    └── seed/
        └── seed.js               # Seeds default roles + Super Admin
```

## Getting Started

```bash
cd backend
npm install
cp .env.example .env
# edit .env with your MongoDB URI and JWT secrets

npm run seed     # creates default roles + Super Admin account
npm run dev      # starts the API with nodemon (http://localhost:5000)
```

Default Super Admin login (change immediately after first login):

```
email:    admin@aquafishingacademy.com
password: ChangeMe@12345
```
(Configurable via `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` in `.env`.)

## API Overview

Base URL: `/api/v1`

| Method | Endpoint                          | Description                         | Auth |
|--------|------------------------------------|--------------------------------------|------|
| GET    | `/health`                          | API health check                     | No |
| POST   | `/auth/register`                   | Public self-registration (Student)   | No |
| POST   | `/auth/login`                      | Log in                               | No |
| POST   | `/auth/refresh`                    | Refresh access token                 | Cookie |
| POST   | `/auth/logout`                     | Log out                              | No |
| GET    | `/auth/me`                         | Get current user                     | Yes |
| PATCH  | `/auth/update-password`            | Change own password                  | Yes |
| POST   | `/auth/forgot-password`            | Request password reset               | No |
| PATCH  | `/auth/reset-password/:token`      | Reset password with token            | No |
| GET    | `/users`                           | List users (search/filter/paginate)  | Yes + `core:users:view` |
| GET    | `/users/:id`                       | Get single user                      | Yes + `core:users:view` |
| POST   | `/users`                           | Create user                          | Yes + `core:users:create` |
| PATCH  | `/users/:id`                       | Update user                          | Yes + `core:users:update` |
| PATCH  | `/users/:id/status`                | Activate/deactivate/suspend user     | Yes + `core:users:update` |
| DELETE | `/users/:id`                       | Delete user                          | Yes + `core:users:delete` |
| GET    | `/roles`                           | List roles                           | Yes + `core:roles:view` |
| GET    | `/roles/permissions`               | Get permission catalogue             | Yes + `core:roles:view` |
| POST   | `/roles`                           | Create role                          | Yes + `core:roles:manage` |
| PATCH  | `/roles/:id`                       | Update role                          | Yes + `core:roles:manage` |
| DELETE | `/roles/:id`                       | Delete role                          | Yes + `core:roles:manage` |

### Phase 2 — Sales CRM & Lead Management

| Method | Endpoint                              | Description                              | Auth |
|--------|-----------------------------------------|--------------------------------------------|------|
| GET    | `/leads`                                | List leads (search/filter/paginate)        | Yes + `crm:leads:view` |
| GET    | `/leads/pipeline`                       | All leads for the Kanban pipeline board    | Yes + `crm:pipeline:view` |
| GET    | `/leads/:id`                            | Get single lead                            | Yes + `crm:leads:view` |
| POST   | `/leads`                                | Capture a new lead                         | Yes + `crm:leads:create` |
| PATCH  | `/leads/:id`                            | Update lead details                        | Yes + `crm:leads:update` |
| DELETE | `/leads/:id`                            | Delete lead (cascades follow-ups/activity) | Yes + `crm:leads:delete` |
| PATCH  | `/leads/:id/assign`                     | Assign/reassign a lead to a sales rep      | Yes + `crm:leads:assign` |
| PATCH  | `/leads/bulk-assign`                    | Bulk-assign multiple leads                 | Yes + `crm:leads:assign` |
| PATCH  | `/leads/:id/stage`                      | Move a lead through the pipeline           | Yes + `crm:pipeline:update` |
| POST   | `/leads/:id/convert`                    | Convert lead to customer                   | Yes + `crm:leads:convert` |
| GET    | `/customers`                            | List customers (search/paginate)           | Yes + `crm:customers:view` |
| GET    | `/customers/:id`                        | Get single customer                        | Yes + `crm:customers:view` |
| PATCH  | `/customers/:id`                        | Update customer                            | Yes + `crm:customers:update` |
| DELETE | `/customers/:id`                        | Delete customer                            | Yes + `crm:customers:delete` |
| GET    | `/follow-ups`                           | Follow-ups for a lead/customer             | Yes |
| GET    | `/follow-ups/mine`                      | Follow-ups scheduled by the current user   | Yes |
| POST   | `/follow-ups`                           | Schedule a follow-up                       | Yes + `crm:followups:create` |
| PATCH  | `/follow-ups/:id`                       | Edit a follow-up                           | Yes + `crm:followups:update` |
| PATCH  | `/follow-ups/:id/complete`              | Mark a follow-up complete                  | Yes + `crm:followups:update` |
| DELETE | `/follow-ups/:id`                       | Delete a follow-up                         | Yes + `crm:followups:update` |
| GET    | `/activities`                           | Activity/interaction timeline              | Yes |
| POST   | `/activities`                           | Log an interaction                         | Yes + `crm:activities:create` |
| GET    | `/payment-links`                        | Payment links for a customer               | Yes |
| POST   | `/payment-links`                        | Generate a payment link                    | Yes + `crm:payments:create` |
| PATCH  | `/payment-links/:id/cancel`             | Cancel a pending payment link              | Yes + `crm:payments:create` |
| GET    | `/sales-team`                           | Sales team roster + workload stats         | Yes + `crm:sales-team:view` |
| GET    | `/sales-team/:userId/stats`             | Single rep's workload stats                | Yes + `crm:sales-team:view` |
| GET    | `/sales-performance/overview`           | New leads, conversion rate, revenue        | Yes + `crm:performance:view` |
| GET    | `/sales-performance/by-rep`             | Revenue by sales rep                       | Yes + `crm:performance:view` |
| GET    | `/sales-performance/by-source`          | Lead volume by source                      | Yes + `crm:performance:view` |
| GET    | `/sales-performance/by-stage`           | Pipeline distribution                      | Yes + `crm:performance:view` |

### Phase 2.2 — Calendar & Class Scheduling

| Method | Endpoint                    | Description                                                    | Auth |
|--------|------------------------------|------------------------------------------------------------------|------|
| GET    | `/calendar?start=&end=`     | List calendar entries in a date range (for month/week views)     | Yes + `crm:calendar:view` |
| GET    | `/calendar/teachers`        | Active staff roster for the "Teacher" dropdown                   | Yes + `crm:calendar:view` |
| GET    | `/calendar/:id`             | Get a single calendar entry                                      | Yes + `crm:calendar:view` |
| POST   | `/calendar`                 | Add a lead (`type: "demo"`) or a student class (`type: "class"`) | Yes + `crm:calendar:create` |
| PATCH  | `/calendar/:id`             | Edit date/time/teacher/notes/status                               | Yes + `crm:calendar:update` |
| PATCH  | `/calendar/:id/status`      | Quick status toggle (scheduled/completed/cancelled/no_show)      | Yes + `crm:calendar:update` |
| DELETE | `/calendar/:id`             | Remove a calendar entry                                           | Yes + `crm:calendar:delete` |
| POST   | `/customers`                | Add a new student directly (without converting a lead)           | Yes + `crm:customers:create` |

The calendar is entirely manual — nothing is auto-scheduled. A sales rep/admin
adds a lead onto the calendar when a slot is agreed (`type: "demo"`), or adds
a class session for an enrolled student with a teacher and time (`type: "class"`).
Multiple entries can be added for the same day (e.g. a student's first and
second class), and a brand-new student can be created inline while scheduling
their first class.


## Security Notes

- Passwords hashed with bcrypt (cost factor 12).
- Access tokens are short-lived JWTs sent in the response body; refresh tokens are long-lived JWTs stored in an httpOnly, sameSite=strict cookie.
- Failed login attempts are tracked; accounts lock for 15 minutes after 5 failed attempts.
- Request bodies sanitized against NoSQL injection and XSS.
- Helmet sets secure HTTP headers; rate limiting applied to all `/api` routes.

## Next Phases

This foundation is designed so Phase 2 (Sales CRM) and beyond can be added as new `models/`, `controllers/`, and `routes/` files that reuse the same auth, RBAC, validation and error-handling layers without any rework.
