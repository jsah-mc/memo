# Memo Composio broker

This private Vercel service keeps the Composio developer credential out of the
desktop application. Memo authenticates with a separate broker token stored in
the operating-system credential store, while app accounts continue to use
Composio's normal OAuth authorization pages.

Required Vercel environment variables:

- `COMPOSIO_API_KEY`
- `MEMO_BROKER_TOKEN`
- `MEMO_COMPOSIO_USER_ID`

The Vercel project root must be `services/composio-broker`.
