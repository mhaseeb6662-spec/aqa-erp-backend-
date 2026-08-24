# What was fixed in this update

## Root cause of "user isn't being created" and "assign isn't working"

Both features were being blocked the same way: the "Add user" role dropdown
and the "Assign lead" sales-rep dropdown are HTML `<select required>`
elements. When their options list is empty, the browser silently refuses to
submit the form — no error, no toast, nothing visibly happens.

That happens in a chain:

1. On a fresh/empty database, if `npm run seed` was never run (or was run
   against a different database than the app is actually using), the
   **Roles** collection is empty.
2. Empty Roles → the "Add user" role dropdown has nothing to select →
   **no user can ever be created** through the UI.
3. Because no users can be created, no Sales Agent/Sales Manager accounts
   exist either → the "Assign lead" dropdown (which only lists active users
   with those two roles) is also empty → **assignment silently fails** too.

## Fixes applied

1. **`src/seed/ensureCoreData.js` (new) + `server.js`** — the default
   system roles and a Super Admin account are now created automatically
   every time the API boots, not only via a manual `npm run seed`. It's a
   no-op once the data already exists, so it's safe to run on every start.
   This removes the failure mode above entirely, even on a brand-new
   database.
2. **`src/config/rbac.constants.js`** — the built-in **Admin** role was
   missing every CRM/leads permission (view, assign, sales-team view,
   etc.), so an Admin-level account could create users but could never
   assign or manage leads. Admin now has full CRM access alongside its
   existing user/role management permissions. (This is re-synced
   automatically for existing roles too, via the same `ensureCoreData`
   step, so you don't need to touch the database by hand.)
3. **`src/seed/seed.js`** — refactored to reuse the shared
   `ensureCoreData()` logic instead of duplicating it (no behavior change,
   just removes the duplicate code path so the two stay in sync).

## Also cleaned up

- Removed the platform-specific `node_modules` from the zip. If this was
  built/zipped on Windows, the previous archive could ship native binaries
  that don't run on Linux/macOS (we hit exactly this with a Rollup native
  binary while testing). Run `npm install` after unzipping.

## To deploy this update

```bash
npm install
npm start        # or: npm run dev
```

You do **not** need to run `npm run seed` manually anymore — it happens
automatically on boot — but running it once by hand is still fine and
harmless if you prefer to do it explicitly.
