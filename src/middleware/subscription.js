/**
 * Subscription Middleware
 * 
 * Fetches user's subscription tier from user_profiles table
 * and attaches it to the request object.
 * 
 * After this middleware:
 *   req.tier     → 'free' | 'paid'
 *   req.limits   → { max_projects, max_devices_per_project, allowed_project_types, label }
 */

const { supabaseAdmin } = require('../services/supabase');
const { getLimits } = require('../../config/tier-limits');

async function attachTier(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      req.tier = 'free';
      req.limits = getLimits('free');
      return next();
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('subscription_tier')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      // No profile found — treat as free, create one
      await supabaseAdmin
        .from('user_profiles')
        .insert({ user_id: userId, subscription_tier: 'free' })
        .select()
        .single();

      req.tier = 'free';
      req.limits = getLimits('free');
      return next();
    }

    req.tier = data.subscription_tier || 'free';
    req.limits = getLimits(req.tier);
    next();
  } catch (err) {
    console.error('[Subscription] Error fetching tier:', err.message);
    req.tier = 'free';
    req.limits = getLimits('free');
    next();
  }
}

module.exports = { attachTier };
