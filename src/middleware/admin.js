/**
 * Admin Middleware
 * 
 * Checks if the authenticated user has admin privileges.
 * Must be used AFTER the authenticate middleware.
 * 
 * Usage:
 *   router.use(authenticate);
 *   router.use(requireAdmin);
 */

const { supabaseAdmin } = require('../services/supabase');

async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('is_admin')
      .eq('user_id', userId)
      .single();

    if (error || !data || !data.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.isAdmin = true;
    next();
  } catch (err) {
    console.error('[Admin] Middleware error:', err.message);
    return res.status(500).json({ error: 'Failed to verify admin status' });
  }
}

module.exports = { requireAdmin };
