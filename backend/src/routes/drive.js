import express from 'express';

const router = express.Router();

// Google Drive API base URLs
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Middleware to extract and validate access token
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  req.accessToken = authHeader.substring(7);
  next();
}

/**
 * POST /drive/files/list
 * List files in appdata folder
 * Body: { q?, pageSize?, pageToken?, fields? }
 */
router.post('/files/list', requireAuth, async (req, res) => {
  const { q, pageSize = 100, pageToken, fields } = req.body;

  try {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      pageSize: pageSize.toString(),
      ...(q && { q }),
      ...(pageToken && { pageToken }),
      ...(fields && { fields })
    });

    const response = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${req.accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Drive API error',
        details: data.error?.message || data.error
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Drive list error:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

/**
 * GET /drive/files/:fileId
 * Get file metadata
 */
router.get('/files/:fileId', requireAuth, async (req, res) => {
  const { fileId } = req.params;
  const { fields } = req.query;

  try {
    const params = new URLSearchParams({
      ...(fields && { fields })
    });

    const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${req.accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Drive API error',
        details: data.error?.message || data.error
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Drive get error:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

/**
 * GET /drive/files/:fileId/content
 * Download file content
 */
router.get('/files/:fileId/content', requireAuth, async (req, res) => {
  const { fileId } = req.params;

  try {
    const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${req.accessToken}`
      }
    });

    if (!response.ok) {
      const data = await response.json();
      return res.status(response.status).json({
        error: 'Drive API error',
        details: data.error?.message || data.error
      });
    }

    // Stream the response
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Drive download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

/**
 * POST /drive/files
 * Create a new file in appdata folder
 * Body: { name, content, mimeType? }
 */
router.post('/files', requireAuth, async (req, res) => {
  const { name, content, mimeType = 'application/json' } = req.body;

  if (!name || content === undefined) {
    return res.status(400).json({ error: 'name and content are required' });
  }

  try {
    const metadata = {
      name,
      parents: ['appDataFolder']
    };

    const boundary = '-------ownstash_boundary';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      '',
      typeof content === 'string' ? content : JSON.stringify(content),
      `--${boundary}--`
    ].join('\r\n');

    const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Drive API error',
        details: data.error?.message || data.error
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Drive create error:', error);
    res.status(500).json({ error: 'Failed to create file' });
  }
});

/**
 * PATCH /drive/files/:fileId
 * Update file content
 * Body: { content, mimeType? }
 */
router.patch('/files/:fileId', requireAuth, async (req, res) => {
  const { fileId } = req.params;
  const { content, mimeType = 'application/json' } = req.body;

  if (content === undefined) {
    return res.status(400).json({ error: 'content is required' });
  }

  try {
    const response = await fetch(`${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${req.accessToken}`,
        'Content-Type': mimeType
      },
      body: typeof content === 'string' ? content : JSON.stringify(content)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Drive API error',
        details: data.error?.message || data.error
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Drive update error:', error);
    res.status(500).json({ error: 'Failed to update file' });
  }
});

/**
 * DELETE /drive/files/:fileId
 * Delete a file
 */
router.delete('/files/:fileId', requireAuth, async (req, res) => {
  const { fileId } = req.params;

  try {
    const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${req.accessToken}`
      }
    });

    if (!response.ok && response.status !== 204) {
      const data = await response.json();
      return res.status(response.status).json({
        error: 'Drive API error',
        details: data.error?.message || data.error
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Drive delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

/**
 * POST /drive/files/:fileId/copy
 * Copy a file
 * Body: { name?, parents? }
 */
router.post('/files/:fileId/copy', requireAuth, async (req, res) => {
  const { fileId } = req.params;
  const { name, parents } = req.body;

  try {
    const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}/copy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...(name && { name }),
        ...(parents && { parents })
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Drive API error',
        details: data.error?.message || data.error
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Drive copy error:', error);
    res.status(500).json({ error: 'Failed to copy file' });
  }
});

/**
 * GET /drive/about
 * Get Drive storage quota info
 */
router.get('/about', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`${DRIVE_API_BASE}/about?fields=storageQuota,user`, {
      headers: {
        Authorization: `Bearer ${req.accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Drive API error',
        details: data.error?.message || data.error
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Drive about error:', error);
    res.status(500).json({ error: 'Failed to get Drive info' });
  }
});

export default router;
