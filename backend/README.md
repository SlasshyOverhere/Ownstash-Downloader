# Ownstash Backend

Backend service for Ownstash Downloader - handles OAuth authentication and Google Drive API securely.

## Features

- **Secure OAuth Flow**: Client secrets never exposed to the desktop app
- **Token Exchange**: Handles authorization code → token exchange server-side
- **Token Refresh**: Refreshes expired tokens without exposing secrets
- **Drive API Proxy**: Proxies Google Drive API requests (optional, for additional security)

## Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/config` | Get OAuth config (client ID, scopes) |
| GET | `/auth/url` | Generate OAuth authorization URL |
| POST | `/auth/token` | Exchange auth code for tokens |
| POST | `/auth/refresh` | Refresh expired access token |
| POST | `/auth/revoke` | Revoke token (logout) |
| GET | `/auth/userinfo` | Get user info |
| GET | `/auth/callback` | OAuth callback (redirects to app) |

### Google Drive

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/drive/files/list` | List files in appdata |
| GET | `/drive/files/:id` | Get file metadata |
| GET | `/drive/files/:id/content` | Download file content |
| POST | `/drive/files` | Create new file |
| PATCH | `/drive/files/:id` | Update file content |
| DELETE | `/drive/files/:id` | Delete file |
| GET | `/drive/about` | Get Drive storage info |

## Deployment on Render

1. Push this `backend` folder to a GitHub repository
2. Create a new Web Service on Render
3. Connect to your repository
4. Set the following environment variables:
   - `GOOGLE_CLIENT_ID`: Your Google OAuth client ID
   - `GOOGLE_CLIENT_SECRET`: Your Google OAuth client secret
   - `ALLOWED_ORIGINS`: Comma-separated list of allowed origins
   - `APP_SCHEME`: Deep link scheme (default: `ownstash`)
5. Deploy!

## Local Development

```bash
# Copy environment file
cp .env.example .env

# Edit .env with your credentials
# Then install and run
npm install
npm run dev
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | Yes |
| `PORT` | Server port (default: 3000) | No |
| `NODE_ENV` | Environment (development/production) | No |
| `ALLOWED_ORIGINS` | CORS allowed origins | No |
| `APP_SCHEME` | Deep link scheme | No |

## Security Notes

- Never commit `.env` file with real credentials
- Client secret is only used server-side
- Access tokens are passed to the client for Drive API calls
- Refresh tokens are stored client-side (encrypted in app storage)
