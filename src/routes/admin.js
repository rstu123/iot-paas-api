/**
 * Admin API Routes
 * 
 * All routes require admin privileges.
 * 
 * GET  /api/admin/stats              — platform-wide statistics
 * GET  /api/admin/users              — list all users with usage info
 * GET  /api/admin/users/:id          — get single user details
 * PATCH /api/admin/users/:id/tier    — change user subscription tier
 * PATCH /api/admin/users/:id/admin   — toggle admin status
 * GET  /api/admin/projects           — list all projects
 * GET  /api/admin/devices            — list all devices with status
 * GET  /api/admin/devices/online     — list currently online devices
 * DELETE /api/admin/users/:id        — delete a user and all their data
 */

const express = require('express');
const { param, body, query, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { supabaseAdmin } = require('../services/supabase');
const mqttService = require('../services/mqtt');

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ═══════════════════════════════════════════════════
// GET /api/admin/stats
// Platform-wide statistics overview
// ═══════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    // Total users
    const { count: totalUsers } = await supabaseAdmin
      .from('user_profiles')
      .select('*', { count: 'exact', head: true });

    // Users by tier
    const { count: freeUsers } = await supabaseAdmin
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_tier', 'free');

    const { count: paidUsers } = await supabaseAdmin
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_tier', 'paid');

    // Total projects
    const { count: totalProjects } = await supabaseAdmin
      .from('projects')
      .select('*', { count: 'exact', head: true });

    // Projects by type
    const { count: normalProjects } = await supabaseAdmin
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('project_type', 'normal');

    const { count: batchProjects } = await supabaseAdmin
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('project_type', 'batch');

    // Total devices
    const { count: totalDevices } = await supabaseAdmin
      .from('devices')
      .select('*', { count: 'exact', head: true });

    // Online devices
    const { count: onlineDevices } = await supabaseAdmin
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .eq('is_online', true);

    // Total channels
    const { count: totalChannels } = await supabaseAdmin
      .from('device_channels')
      .select('*', { count: 'exact', head: true });

    // MQTT status
    const mqttStatus = mqttService.getStatus();

    res.json({
      users: {
        total: totalUsers || 0,
        free: freeUsers || 0,
        paid: paidUsers || 0,
      },
      projects: {
        total: totalProjects || 0,
        normal: normalProjects || 0,
        batch: batchProjects || 0,
      },
      devices: {
        total: totalDevices || 0,
        online: onlineDevices || 0,
        offline: (totalDevices || 0) - (onlineDevices || 0),
      },
      channels: {
        total: totalChannels || 0,
      },
      mqtt: mqttStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Admin] Stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ═══════════════════════════════════════════════════
// GET /api/admin/users
// List all users with their usage information
// ═══════════════════════════════════════════════════
router.get('/users',
  query('search').optional().isString().trim(),
  query('tier').optional().isIn(['free', 'paid', 'all']),
  validate,
  async (req, res) => {
    try {
      // Get all user profiles
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Get auth users for email/metadata
      const { data: { users: authUsers }, error: authError } = await supabaseAdmin.auth.admin.listUsers();

      if (authError) throw authError;

      // Get project counts per user
      const { data: projectCounts } = await supabaseAdmin
        .from('projects')
        .select('user_id');

      // Get device counts per user (through projects)
      const { data: allProjects } = await supabaseAdmin
        .from('projects')
        .select('id, user_id');

      const { data: allDevices } = await supabaseAdmin
        .from('devices')
        .select('id, project_id, is_online');

      // Build user data
      const users = (profiles || []).map((profile) => {
        const authUser = authUsers?.find((u) => u.id === profile.user_id);
        const userProjects = (allProjects || []).filter((p) => p.user_id === profile.user_id);
        const userProjectIds = userProjects.map((p) => p.id);
        const userDevices = (allDevices || []).filter((d) => userProjectIds.includes(d.project_id));
        const onlineDevices = userDevices.filter((d) => d.is_online);

        return {
          id: profile.user_id,
          email: authUser?.email || 'Unknown',
          username: authUser?.user_metadata?.username || 'Unknown',
          tier: profile.subscription_tier || 'free',
          is_admin: profile.is_admin || false,
          project_count: userProjects.length,
          device_count: userDevices.length,
          online_devices: onlineDevices.length,
          created_at: authUser?.created_at || profile.created_at,
          last_sign_in: authUser?.last_sign_in_at || null,
        };
      });

      // Apply filters
      let filtered = users;

      if (req.query.tier && req.query.tier !== 'all') {
        filtered = filtered.filter((u) => u.tier === req.query.tier);
      }

      if (req.query.search) {
        const search = req.query.search.toLowerCase();
        filtered = filtered.filter(
          (u) =>
            u.email.toLowerCase().includes(search) ||
            u.username.toLowerCase().includes(search)
        );
      }

      res.json({
        users: filtered,
        total: filtered.length,
      });
    } catch (err) {
      console.error('[Admin] Users error:', err.message);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }
);

// ═══════════════════════════════════════════════════
// GET /api/admin/users/:id
// Get detailed info about a single user
// ═══════════════════════════════════════════════════
router.get('/users/:id',
  param('id').isUUID(),
  validate,
  async (req, res) => {
    try {
      const userId = req.params.id;

      // Get profile
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      // Get auth user
      const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);

      // Get projects with device counts
      const { data: projects } = await supabaseAdmin
        .from('projects')
        .select('*, devices(count)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      const formattedProjects = (projects || []).map((p) => ({
        ...p,
        device_count: p.devices?.[0]?.count ?? 0,
        devices: undefined,
      }));

      // Get all devices
      const projectIds = (projects || []).map((p) => p.id);
      const { data: devices } = await supabaseAdmin
        .from('devices')
        .select('id, name, hardware_type, is_online, project_id, created_at')
        .in('project_id', projectIds.length > 0 ? projectIds : ['00000000-0000-0000-0000-000000000000']);

      res.json({
        user: {
          id: userId,
          email: authUser?.email || 'Unknown',
          username: authUser?.user_metadata?.username || 'Unknown',
          tier: profile?.subscription_tier || 'free',
          is_admin: profile?.is_admin || false,
          created_at: authUser?.created_at,
          last_sign_in: authUser?.last_sign_in_at,
        },
        projects: formattedProjects,
        devices: devices || [],
      });
    } catch (err) {
      console.error('[Admin] User detail error:', err.message);
      res.status(500).json({ error: 'Failed to fetch user details' });
    }
  }
);

// ═══════════════════════════════════════════════════
// PATCH /api/admin/users/:id/tier
// Change a user's subscription tier
// ═══════════════════════════════════════════════════
router.patch('/users/:id/tier',
  param('id').isUUID(),
  body('tier').isIn(['free', 'paid']),
  validate,
  async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .update({ subscription_tier: req.body.tier })
        .eq('user_id', req.params.id)
        .select()
        .single();

      if (error) throw error;

      console.log(`[Admin] Changed user ${req.params.id} tier to ${req.body.tier}`);

      res.json({
        success: true,
        user_id: req.params.id,
        tier: req.body.tier,
      });
    } catch (err) {
      console.error('[Admin] Tier change error:', err.message);
      res.status(500).json({ error: 'Failed to change tier' });
    }
  }
);

// ═══════════════════════════════════════════════════
// PATCH /api/admin/users/:id/admin
// Toggle admin status for a user
// ═══════════════════════════════════════════════════
router.patch('/users/:id/admin',
  param('id').isUUID(),
  body('is_admin').isBoolean(),
  validate,
  async (req, res) => {
    try {
      // Prevent removing own admin
      if (req.params.id === req.user.id && !req.body.is_admin) {
        return res.status(400).json({ error: 'Cannot remove your own admin access' });
      }

      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .update({ is_admin: req.body.is_admin })
        .eq('user_id', req.params.id)
        .select()
        .single();

      if (error) throw error;

      console.log(`[Admin] Set user ${req.params.id} admin=${req.body.is_admin}`);

      res.json({
        success: true,
        user_id: req.params.id,
        is_admin: req.body.is_admin,
      });
    } catch (err) {
      console.error('[Admin] Admin toggle error:', err.message);
      res.status(500).json({ error: 'Failed to toggle admin status' });
    }
  }
);

// ═══════════════════════════════════════════════════
// DELETE /api/admin/users/:id
// Delete a user and all their data
// ═══════════════════════════════════════════════════
router.delete('/users/:id',
  param('id').isUUID(),
  validate,
  async (req, res) => {
    try {
      const userId = req.params.id;

      // Prevent self-deletion
      if (userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account from admin panel' });
      }

      // Delete user's projects (cascades to devices and channels)
      const { error: projectsError } = await supabaseAdmin
        .from('projects')
        .delete()
        .eq('user_id', userId);

      if (projectsError) console.error('[Admin] Error deleting projects:', projectsError);

      // Delete user profile
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .delete()
        .eq('user_id', userId);

      if (profileError) console.error('[Admin] Error deleting profile:', profileError);

      // Delete auth user
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (authError) throw authError;

      console.log(`[Admin] Deleted user ${userId} and all their data`);

      res.json({
        success: true,
        message: 'User and all associated data deleted',
      });
    } catch (err) {
      console.error('[Admin] Delete user error:', err.message);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

// ═══════════════════════════════════════════════════
// GET /api/admin/projects
// List all projects across all users
// ═══════════════════════════════════════════════════
router.get('/projects', async (req, res) => {
  try {
    const { data: projects, error } = await supabaseAdmin
      .from('projects')
      .select('*, devices(count)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get auth users for owner info
    const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();

    const formatted = (projects || []).map((p) => {
      const owner = authUsers?.find((u) => u.id === p.user_id);
      return {
        ...p,
        device_count: p.devices?.[0]?.count ?? 0,
        devices: undefined,
        owner_email: owner?.email || 'Unknown',
        owner_username: owner?.user_metadata?.username || 'Unknown',
      };
    });

    res.json({ projects: formatted });
  } catch (err) {
    console.error('[Admin] Projects error:', err.message);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// ═══════════════════════════════════════════════════
// GET /api/admin/devices
// List all devices with owner info
// ═══════════════════════════════════════════════════
router.get('/devices',
  query('status').optional().isIn(['online', 'offline', 'all']),
  validate,
  async (req, res) => {
    try {
      let queryBuilder = supabaseAdmin
        .from('devices')
        .select('*, project:projects!inner(id, name, user_id)')
        .order('created_at', { ascending: false });

      if (req.query.status === 'online') {
        queryBuilder = queryBuilder.eq('is_online', true);
      } else if (req.query.status === 'offline') {
        queryBuilder = queryBuilder.eq('is_online', false);
      }

      const { data: devices, error } = await queryBuilder;
      if (error) throw error;

      // Get auth users
      const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();

      const formatted = (devices || []).map((d) => {
        const owner = authUsers?.find((u) => u.id === d.project?.user_id);
        return {
          id: d.id,
          name: d.name,
          hardware_type: d.hardware_type,
          is_online: d.is_online,
          last_seen: d.last_seen,
          project_name: d.project?.name || 'Unknown',
          owner_email: owner?.email || 'Unknown',
          owner_username: owner?.user_metadata?.username || 'Unknown',
          created_at: d.created_at,
        };
      });

      res.json({ devices: formatted, total: formatted.length });
    } catch (err) {
      console.error('[Admin] Devices error:', err.message);
      res.status(500).json({ error: 'Failed to fetch devices' });
    }
  }
);

// ═══════════════════════════════════════════════════
// GET /api/admin/check
// Simple endpoint for frontend to check if user is admin
// ═══════════════════════════════════════════════════
router.get('/check', (req, res) => {
  res.json({ is_admin: true });
});

module.exports = router;
