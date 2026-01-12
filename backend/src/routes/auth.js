import express from 'express';

const router = express.Router();

// Google OAuth configuration
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Scopes required for Google Drive appdata access
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.appdata'
].join(' ');

/**
 * GET /auth/config
 * Returns OAuth configuration for the client (without exposing secrets)
 */
router.get('/config', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({ error: 'OAuth not configured' });
  }

  res.json({
    clientId,
    scopes: SCOPES,
    authUrl: GOOGLE_AUTH_URL
  });
});

/**
 * GET /auth/url
 * Generates the OAuth authorization URL
 * Query params: redirect_uri, state (optional)
 */
router.get('/url', (req, res) => {
  const { redirect_uri, state } = req.query;
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({ error: 'OAuth not configured' });
  }

  if (!redirect_uri) {
    return res.status(400).json({ error: 'redirect_uri is required' });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    ...(state && { state })
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

  res.json({ url: authUrl });
});

/**
 * POST /auth/token
 * Exchanges authorization code for tokens
 * Body: { code, redirect_uri }
 */
router.post('/token', async (req, res) => {
  const { code, redirect_uri } = req.body;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'OAuth not configured' });
  }

  if (!code || !redirect_uri) {
    return res.status(400).json({ error: 'code and redirect_uri are required' });
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri,
        grant_type: 'authorization_code'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Token exchange error:', data);
      return res.status(response.status).json({
        error: 'Token exchange failed',
        details: data.error_description || data.error
      });
    }

    // Return tokens to client
    res.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      scope: data.scope,
      id_token: data.id_token
    });
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

/**
 * POST /auth/refresh
 * Refreshes an expired access token
 * Body: { refresh_token }
 */
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'OAuth not configured' });
  }

  if (!refresh_token) {
    return res.status(400).json({ error: 'refresh_token is required' });
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token,
        grant_type: 'refresh_token'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Token refresh error:', data);
      return res.status(response.status).json({
        error: 'Token refresh failed',
        details: data.error_description || data.error
      });
    }

    res.json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      scope: data.scope
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * POST /auth/revoke
 * Revokes a token (for logout)
 * Body: { token }
 */
router.post('/revoke', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  try {
    const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!response.ok && response.status !== 400) {
      // 400 means token was already invalid/revoked, which is fine
      const data = await response.json();
      console.error('Token revoke error:', data);
      return res.status(response.status).json({
        error: 'Token revocation failed',
        details: data.error_description || data.error
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Token revoke error:', error);
    res.status(500).json({ error: 'Token revocation failed' });
  }
});

/**
 * GET /auth/userinfo
 * Gets user info using access token
 * Headers: Authorization: Bearer <access_token>
 */
router.get('/userinfo', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  const accessToken = authHeader.substring(7);

  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to get user info',
        details: data.error?.message || data.error
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Userinfo error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * GET /auth/callback
 * OAuth callback handler - redirects to app with tokens
 * This is used when the backend itself handles the redirect
 */
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const appScheme = process.env.APP_SCHEME || 'ownstash';

  if (error) {
    // Redirect to app with error
    return res.redirect(`${appScheme}://auth/error?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`${appScheme}://auth/error?error=no_code`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // The redirect URI must match what was used in the initial request
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Callback token exchange error:', data);
      return res.redirect(`${appScheme}://auth/error?error=${encodeURIComponent(data.error_description || data.error)}`);
    }

    // Build deep link with tokens
    const params = new URLSearchParams({
      access_token: data.access_token,
      token_type: data.token_type,
      expires_in: data.expires_in.toString(),
      scope: data.scope,
      ...(data.refresh_token && { refresh_token: data.refresh_token }),
      ...(state && { state })
    });

    // Show success page that redirects to app
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Successful</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%);
            overflow: hidden;
        }
        body {
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: white;
        }
        .card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            padding: 48px;
            text-align: center;
            max-width: 400px;
            backdrop-filter: blur(20px);
        }
        .success-icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #10b981, #059669);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            font-size: 40px;
        }
        h1 { font-size: 24px; margin-bottom: 8px; }
        .subtitle { color: rgba(255,255,255,0.6); margin-bottom: 24px; }
        .loading { display: flex; align-items: center; justify-content: center; gap: 12px; color: rgba(255,255,255,0.5); }
        .spinner {
            width: 20px; height: 20px;
            border: 2px solid rgba(255,255,255,0.2);
            border-top-color: #10b981;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .btn {
            display: inline-block;
            margin-top: 24px;
            padding: 12px 32px;
            background: linear-gradient(135deg, #10b981, #059669);
            color: white;
            text-decoration: none;
            border-radius: 12px;
            font-weight: 600;
        }
        .hint { margin-top: 16px; font-size: 12px; color: rgba(255,255,255,0.4); }
    </style>
</head>
<body>
    <div class="card">
        <div class="success-icon">✓</div>
        <h1>You're All Set!</h1>
        <p class="subtitle">Authentication successful.<br>Opening Ownstash Downloader...</p>
        <div class="loading">
            <div class="spinner"></div>
            <span>Launching app...</span>
        </div>
        <a href="${appScheme}://auth/callback#${params.toString()}" class="btn">Open App</a>
        <p class="hint">You can close this tab after the app opens</p>
    </div>
    <script>
        setTimeout(function() {
            window.location.href = "${appScheme}://auth/callback#${params.toString()}";
        }, 500);
    </script>
</body>
</html>
    `);
  } catch (error) {
    console.error('Callback error:', error);
    res.redirect(`${appScheme}://auth/error?error=server_error`);
  }
});

export default router;
