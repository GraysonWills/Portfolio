# Environment Matrix Template

| Variable | Local | Stage | Prod | Owner |
|---|---|---|---|---|
| API_BASE_URL | http://localhost:3000/api | <stage-api> | <prod-api> | Backend |
| ALLOWED_ORIGINS | localhost entries | stage domains | prod domains | Backend |
| COGNITO_REGION | optional | required | required | Platform |
| COGNITO_USER_POOL_ID | optional | required | required | Platform |
| COGNITO_CLIENT_ID | optional | required | required | Platform |
| S3_UPLOAD_BUCKET | optional | required | required | Platform |
| SES_FROM_EMAIL | optional | required | required | Platform |
| CONTENT_BACKEND | redis | redis/ddb | redis/ddb | Backend |

