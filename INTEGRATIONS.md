# Inbound Lead Webhooks — Setup Guide

This ERP can now automatically pull in leads from three channels without
anyone manually typing them into the Leads page:

- **Facebook / Instagram Lead Ads** (Meta)
- **Google Ads Lead Form** extensions
- **WhatsApp** (incoming customer messages)

Every new lead lands on the normal **Leads** page exactly like a manually
added one — same pipeline, same "Assign", same activity timeline — just
tagged with its real source (`Facebook Ads`, `Google Ads`, `WhatsApp`) and
auto-assigned to whichever active Sales Agent currently has the fewest open
leads. Nothing is created twice: re-sent webhook deliveries are detected and
just add a note to the existing lead instead of duplicating it.

Your public webhook URLs (replace `https://your-domain.com` with wherever
this backend is deployed — Meta/Google/WhatsApp must be able to reach it
over the public internet, `localhost` will not work):

```
https://your-domain.com/api/v1/webhooks/leads/meta
https://your-domain.com/api/v1/webhooks/leads/google
https://your-domain.com/api/v1/webhooks/leads/whatsapp
```

All the values below go in your `.env` file (see `.env.example`). Every
source is independent and optional — leaving one blank simply leaves that
channel inactive; it does not affect the others or the rest of the ERP.

---

## 1. Facebook / Instagram Lead Ads

1. Create/open your app at [developers.facebook.com](https://developers.facebook.com/apps).
2. Add the **Webhooks** product → Subscribe to the **Page** object, field
   **leadgen**.
3. Callback URL: `https://your-domain.com/api/v1/webhooks/leads/meta`
   Verify Token: any string you invent — put the same string in
   `META_VERIFY_TOKEN` in `.env`.
4. In **App Dashboard → Settings → Basic**, copy the **App Secret** into
   `META_APP_SECRET` (recommended — this is what lets the server confirm a
   webhook call really came from Meta).
5. Generate a **Page Access Token** with the `leads_retrieval` and
   `pages_manage_ads` permissions for the Page running your lead ads, and
   put it in `META_PAGE_ACCESS_TOKEN`. This is required — Meta's webhook
   only tells us a lead exists, the actual name/phone/email is fetched
   from the Graph API using this token.
6. Subscribe your Page to the app's webhook (Page Settings → Webhooks, or
   via the Graph API `/{page-id}/subscribed_apps` endpoint).

## 2. Google Ads Lead Form extension

1. In Google Ads, open your Lead Form asset → **Lead delivery options**.
2. Choose delivery method **Webhook**.
3. Webhook URL: `https://your-domain.com/api/v1/webhooks/leads/google`
   Webhook key: any string you invent — put the same string in
   `GOOGLE_ADS_WEBHOOK_KEY` in `.env`. Google sends this key back on every
   payload so the server can confirm it's a genuine request.
4. Save — Google immediately sends a test payload (`is_test: true`), which
   the server acknowledges without creating a lead. If you don't see a
   green checkmark in Google Ads, double-check the URL is publicly
   reachable and the key matches exactly.

## 3. WhatsApp Business Cloud API

1. In the same Meta App as above, add the **WhatsApp** product.
2. Under **Configuration → Webhook**, callback URL:
   `https://your-domain.com/api/v1/webhooks/leads/whatsapp`
   Verify token: same as `META_VERIFY_TOKEN` (or set `WHATSAPP_VERIFY_TOKEN`
   separately if this lives under a different app).
3. Subscribe to the **messages** field.
4. Fill in `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` from the
   WhatsApp → API Setup page (only needed if you later want the server to
   send replies — inbound lead capture works without them).

Every first-time message from a new WhatsApp number creates a lead. A
message from a number that already exists (from any source — e.g. a lead
that first came from a Facebook ad, then messages your WhatsApp number) is
logged on that same lead's timeline instead of creating a second one.

---

## Notes

- Restart the server after editing `.env` — config is read once at boot.
- All three endpoints always respond `200 OK` (even on a bad signature or
  processing error) so the provider doesn't treat a validation failure as
  a delivery failure and retry-storm the server; problems are written to
  the server logs instead.
- Requires Node.js 18+ (uses the built-in `fetch` to call the Graph API —
  no new npm dependency was added for this).
