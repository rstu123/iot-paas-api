/**
 * Subscription Routes
 * 
 * GET  /api/subscription           — get user's tier, limits, usage
 * POST /api/subscription/upgrade   — upgrade user to paid (demo mode)
 * POST /api/subscription/downgrade — downgrade user to free (demo mode)
 * POST /api/subscription/admin     — admin: change any user's tier
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { attachTier } = require('../middleware/subscription');
const { supabaseAdmin } = require('../services/supabase');
const { TIER_LIMITS } = require('../../config/tier-limits');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/subscription
 * Returns user's subscription info, limits, and current usage
 */
router.get('/', attachTier, async (req, res) => {
  try {
    // Count user's projects
    const { count: projectCount } = await req.supabase
      .from('projects')
      .select('*', { count: 'exact', head: true });

    // Count devices across all projects
    const { count: deviceCount } = await req.supabase
      .from('devices')
      .select('*', { count: 'exact', head: true });

    res.json({
      tier: req.tier,
      limits: {
        max_projects: req.limits.max_projects === Infinity ? null : req.limits.max_projects,
        max_devices_per_project: req.limits.max_devices_per_project === Infinity ? null : req.limits.max_devices_per_project,
        allowed_project_types: req.limits.allowed_project_types,
        label: req.limits.label,
      },
      usage: {
        project_count: projectCount || 0,
        device_count: deviceCount || 0,
      },
    });
  } catch (err) {
    console.error('[Subscription] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch subscription info' });
  }
});

/**
 * POST /api/subscription/upgrade
 * Demo mode: upgrade current user to paid
 */
router.post('/upgrade', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .update({ subscription_tier: 'paid' })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    console.log(`[Subscription] User ${userId} upgraded to paid`);

    res.json({
      success: true,
      tier: 'paid',
      message: 'Upgraded to Paid tier successfully',
    });
  } catch (err) {
    console.error('[Subscription] Upgrade error:', err.message);
    res.status(500).json({ error: 'Failed to upgrade' });
  }
});

/**
 * POST /api/subscription/downgrade
 * Demo mode: downgrade current user to free
 */
router.post('/downgrade', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .update({ subscription_tier: 'free' })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    console.log(`[Subscription] User ${userId} downgraded to free`);

    res.json({
      success: true,
      tier: 'free',
      message: 'Downgraded to Free tier',
    });
  } catch (err) {
    console.error('[Subscription] Downgrade error:', err.message);
    res.status(500).json({ error: 'Failed to downgrade' });
  }
});

module.exports = router;
