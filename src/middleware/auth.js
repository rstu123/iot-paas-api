const { supabaseAdmin, createUserClient } = require('../services/supabase');

/**
 * Authentication middleware
 * Validates the Supabase JWT and attaches user info to the request
 * 
 * After this middleware:
 * - req.user = { id, email, ... }
 * - req.supabase = Supabase client with user's permissions (RLS-aware)
 * - req.accessToken = raw JWT token
 */
async function authenticate(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify the token with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    }
    
    // Attach user info and authenticated client to request
    req.user = user;
    req.accessToken = token;
    req.supabase = createUserClient(token);
    
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Optional authentication - doesn't fail if no token
 * Useful for public endpoints that behave differently for logged-in users
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token, continue without user
    req.user = null;
    req.supabase = null;
    return next();
  }
  
  // Token present, validate it
  return authenticate(req, res, next);
}

module.exports = {
  authenticate,
  optionalAuth,
};
