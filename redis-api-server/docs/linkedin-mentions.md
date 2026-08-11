# LinkedIn mention delivery

The social distribution service accepts validated LinkedIn mention metadata
from Mesh and serializes it into LinkedIn UGC `shareCommentary.attributes`.
The caption itself contains the visible entity name without an `@` prefix.

## Delivery input

```json
{
  "caption": "Built 😀 with OpenAI.",
  "providerOptions": {
    "linkedin": {
      "mentions": [
        {
          "entityType": "organization",
          "urn": "urn:li:organization:12345",
          "displayText": "OpenAI",
          "start": 13,
          "length": 6
        }
      ]
    }
  }
}
```

The service also accepts snake-case `entity_type` and `display_text` for
compatibility. Ranges use Unicode code points, not JavaScript UTF-16 code
units.

| Field | Required format |
| --- | --- |
| `entityType` | `organization` or `person` |
| `urn` | `urn:li:organization:<numeric-id>` or `urn:li:person:<id>` |
| `displayText` | Exact caption substring; no `@` is added |
| `start` | Non-negative integer code-point offset |
| `length` | Positive integer code-point length |

For example, an organization URN ending in a vanity slug, a range that starts
one character before `OpenAI`, or a display value absent from the caption is
invalid. Before any provider request, the service rejects:

- more than 50 mentions;
- entity types other than `person` or `organization`;
- malformed or mismatched URNs;
- negative, empty, out-of-bounds, stale, or overlapping ranges.

Organization mentions become
`com.linkedin.common.CompanyAttributedEntity`; person mentions become
`com.linkedin.common.MemberAttributedEntity`. Deliveries without mention
metadata keep the existing payload shape.

See the upstream Mesh
[operator and API guide](https://github.com/GraysonWills/total-agentic-workflow/blob/main/docs/desktop-app/linkedin-mentions.md)
and LinkedIn's
[UGC post mention documentation](https://learn.microsoft.com/en-us/linkedin/compliance/integrations/shares/ugc-post-api#mentions-in-ugc-posts)
for the provider contract.

## Verification

```bash
node --test test/social-distribution.test.js
```
