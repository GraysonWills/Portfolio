# Data Dictionary Template

## Content Record

| Field | Type | Required | Notes |
|---|---|---|---|
| ID | string | yes | stable unique id |
| ListItemID | string | yes | logical grouping |
| PageID | number | yes | route/page bucket |
| PageContentID | number | yes | semantic content role |
| Text | string | no | text payload |
| Photo | string | no | media URL |
| Metadata | object | no | tags/status/order/etc |
| CreatedAt | string | no | ISO timestamp |
| UpdatedAt | string | no | ISO timestamp |

## Subscriber Record (Optional)

| Field | Type | Required | Notes |
|---|---|---|---|
| emailHash | string | yes | PK, hashed email |
| email | string | yes | normalized lowercase |
| status | enum | yes | PENDING/SUBSCRIBED/... |
| topics | string[] | no | preference list |
| consentVersion | string | no | audit trail |

