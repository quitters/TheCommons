import { randomBytes, timingSafeEqual } from 'node:crypto';

export function adminAccess(password) {
  const sessions = new Map();
  const lifetime = 12 * 60 * 60 * 1000;
  function authorized(req) {
    const cookie = (req.headers.cookie || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith('commons_admin='))?.slice('commons_admin='.length);
    const expires = sessions.get(cookie);
    if (!expires || expires < Date.now()) { sessions.delete(cookie); return false; }
    return true;
  }
  return {
    require(req, res, next) {
      if (!authorized(req)) return res.status(401).json({ error: 'Admin sign-in required.' });
      next();
    },
    status(req, res) { res.json({ authenticated: authorized(req), configured: Boolean(password) }); },
    login(req, res) {
      const supplied = req.body?.password;
      if (!password || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(password)
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(password))) {
        return res.status(401).json({ error: 'Incorrect admin password.' });
      }
      for (const [token, expires] of sessions) if (expires < Date.now()) sessions.delete(token);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + lifetime);
      res.cookie('commons_admin', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: lifetime, path: '/' });
      res.json({ authenticated: true });
    },
    logout(req, res) {
      const token = (req.headers.cookie || '').split(';').map((part) => part.trim())
        .find((part) => part.startsWith('commons_admin='))?.slice('commons_admin='.length);
      sessions.delete(token);
      res.clearCookie('commons_admin', { path: '/' });
      res.json({ authenticated: false });
    },
  };
}
