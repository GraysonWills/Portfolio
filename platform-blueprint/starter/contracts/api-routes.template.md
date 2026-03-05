# API Route Contract Template

## Public Read Routes

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | /api/health | Health summary | none |
| GET | /api/content | Fetch all content | none |

## Protected Write Routes

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | /api/content | Create content | bearer |
| PUT | /api/content/:id | Update content | bearer |
| DELETE | /api/content/:id | Delete content | bearer |

## Notification Routes (Optional)

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | /api/subscriptions/request | Start subscribe flow | none |
| GET | /api/subscriptions/confirm | Confirm token | none |
| GET | /api/subscriptions/unsubscribe | Unsubscribe token | none |
| POST | /api/notifications/schedule | Schedule publish + notify | bearer |

