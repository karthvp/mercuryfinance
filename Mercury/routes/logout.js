const express = require('express');

const router = express.Router();

router.post('/', (req, res) => {
  // A non-safelisted header requires a CORS preflight from another origin.
  // Do not enable cross-origin access to this route: links and HTML forms
  // cannot supply this header, and unapproved preflights cannot authorize it.
  if (req.get('X-Mercury-CSRF') !== '1') {
    return res.status(403).json({ error: 'Invalid logout request' });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Failed to sign out' });
    }
    res.clearCookie('connect.sid', {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
    res.sendStatus(204);
  });
});

// In particular, GET and its implicit HEAD must never invalidate a session.
router.all('/', (req, res) => {
  res.set('Allow', 'POST').status(405).json({ error: 'Method not allowed' });
});

module.exports = router;
