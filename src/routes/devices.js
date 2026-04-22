const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { supabaseAdmin } = require('../services/supabase');
const { attachTier } = require('../middleware/subscription');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

router.use(attachTier);

// Validation helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * GET /api/devices
 * List all devices (optionally filtered by project)
 */
router.get('/',
  query('project_id').optional().isUUID(),
  validate,
  async (req, res) => {
    try {
      let queryBuilder = req.supabase
        .from('devices')
        .select(`
          *,
          project:projects(id, name, slug)
        `)
        .order('created_at', { ascending: false });
      
      if (req.query.project_id) {
        queryBuilder = queryBuilder.eq('project_id', req.query.project_id);
      }
      
      const { data, error } = await queryBuilder;
      
      if (error) throw error;
      
      // Don't expose sensitive fields
      const sanitized = data.map(device => ({
        ...device,
        device_token: undefined,  // Hide token
        mqtt_password_hash: undefined,  // Hide password hash
      }));
      
      res.json({ devices: sanitized });
    } catch (err) {
      console.error('Error fetching devices:', err);
      res.status(500).json({ error: 'Failed to fetch devices' });
    }
  }
);

/**
 * GET /api/devices/:id
 * Get a single device with its channels
 */
router.get('/:id',
  param('id').isUUID(),
  validate,
  async (req, res) => {
    try {
      const { data, error } = await req.supabase
        .from('devices')
        .select(`
          *,
          project:projects(id, name, slug),
          channels:device_channels(*)
        `)
        .eq('id', req.params.id)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Device not found' });
        }
        throw error;
      }
      
      // Don't expose sensitive fields
      const sanitized = {
        ...data,
        device_token: undefined,
        mqtt_password_hash: undefined,
      };
      
      res.json({ device: sanitized });
    } catch (err) {
      console.error('Error fetching device:', err);
      res.status(500).json({ error: 'Failed to fetch device' });
    }
  }
);

/**
 * POST /api/devices
 * Create a new device
 * Returns the device_token (only time it's visible!)
 */
router.post('/',
  body('project_id').isUUID(),
  body('name').isString().trim().isLength({ min: 1, max: 100 }),
  body('hardware_type').optional().isString().trim(),
  validate,
  async (req, res) => {
    try {
      const { project_id, name, hardware_type } = req.body;
      
      // Verify project belongs to user
      const { data: project, error: projectError } = await req.supabase
        .from('projects')
        .select('id')
        .eq('id', project_id)
        .single();
      
      if (projectError || !project) {
        return res.status(404).json({ error: 'Project not found' });
      }

	// ─── Tier enforcement ───
      const { count: deviceCount } = await req.supabase
        .from('devices')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project_id);

      if (req.limits.max_devices_per_project !== Infinity && deviceCount >= req.limits.max_devices_per_project) {
        return res.status(403).json({
          error: `Free tier is limited to ${req.limits.max_devices_per_project} devices per project. Upgrade to add more.`,
          tier: req.tier,
          limit: req.limits.max_devices_per_project,
          current: deviceCount,
        });
      }
      
      // Generate device token using the database function
      const { data: tokenResult } = await supabaseAdmin.rpc('generate_device_token');
      const deviceToken = tokenResult;
      
      // Create the device
      const { data, error } = await req.supabase
        .from('devices')
        .insert({
          project_id,
          name,
          hardware_type: hardware_type || 'ESP32',
          device_token: deviceToken,
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Return device WITH token (only time user sees it)
      res.status(201).json({
        device: {
          ...data,
          mqtt_password_hash: undefined,
        },
        message: 'Save this device_token! It will not be shown again.',
      });
    } catch (err) {
      console.error('Error creating device:', err);
      res.status(500).json({ error: 'Failed to create device' });
    }
  }
);

/**
 * PATCH /api/devices/:id
 * Update a device (name, hardware_type only)
 */
router.patch('/:id',
  param('id').isUUID(),
  body('name').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('hardware_type').optional().isString().trim(),
  validate,
  async (req, res) => {
    try {
      const updates = {};
      if (req.body.name) updates.name = req.body.name;
      if (req.body.hardware_type) updates.hardware_type = req.body.hardware_type;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      
      const { data, error } = await req.supabase
        .from('devices')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Device not found' });
        }
        throw error;
      }
      
      res.json({
        device: {
          ...data,
          device_token: undefined,
          mqtt_password_hash: undefined,
        },
      });
    } catch (err) {
      console.error('Error updating device:', err);
      res.status(500).json({ error: 'Failed to update device' });
    }
  }
);

/**
 * DELETE /api/devices/:id
 * Delete a device (cascades to channels)
 */
router.delete('/:id',
  param('id').isUUID(),
  validate,
  async (req, res) => {
    try {
      const { error } = await req.supabase
        .from('devices')
        .delete()
        .eq('id', req.params.id);
      
      if (error) throw error;
      
      res.status(204).send();
    } catch (err) {
      console.error('Error deleting device:', err);
      res.status(500).json({ error: 'Failed to delete device' });
    }
  }
);

/**
 * POST /api/devices/:id/regenerate-token
 * Generate a new device token (invalidates old one)
 */
router.post('/:id/regenerate-token',
  param('id').isUUID(),
  validate,
  async (req, res) => {
    try {
      // Generate new token
      const { data: tokenResult } = await supabaseAdmin.rpc('generate_device_token');
      const newToken = tokenResult;
      
      // Update device (also resets provisioning status)
      const { data, error } = await req.supabase
        .from('devices')
        .update({
          device_token: newToken,
          is_provisioned: false,
          mqtt_username: null,
          mqtt_password_hash: null,
        })
        .eq('id', req.params.id)
        .select()
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Device not found' });
        }
        throw error;
      }
      
      res.json({
        device: data,
        message: 'New device_token generated. Save it! The old token is now invalid.',
      });
    } catch (err) {
      console.error('Error regenerating token:', err);
      res.status(500).json({ error: 'Failed to regenerate token' });
    }
  }
);

/**
 * GET /api/devices/:id/credentials
 * Get MQTT connection credentials for a device
 */
router.get('/:id/credentials',
  param('id').isUUID(),
  validate,
  async (req, res) => {
    try {
      const { data: device, error } = await req.supabase
        .from('devices')
        .select(`
          id,
          name,
          device_token,
          project:projects!inner(user_id)
        `)
        .eq('id', req.params.id)
        .single();

      if (error || !device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const user_id = device.project.user_id;

      res.json({
        device_name: device.name,
        mqtt: {
          host: process.env.MQTT_HOST || 'localhost',
          port: 1883,
          ssl_port: 8883,
          websocket_port: 8083,
          username: device.id,
          password: device.device_token
        },
        topics: {
          publish: `u/${user_id}/d/${device.id}/up/+`,
          subscribe: `u/${user_id}/d/${device.id}/down/+`
        }
      });
    } catch (err) {
      console.error('Error fetching credentials:', err);
      res.status(500).json({ error: 'Failed to fetch credentials' });
    }
  }
);

// =============================================
// Channel CRUD endpoints
// =============================================

/**
 * POST /api/devices/:id/channels
 * Create a new channel for a device
 */
router.post('/:id/channels',
  param('id').isUUID(),
  body('channel_name').isString().trim().isLength({ min: 1, max: 50 }),
  body('channel_type').isIn(['control', 'sensor']),
  body('data_type').isIn(['toggle', 'slider', 'input', 'number', 'text']),
  body('unit').optional({ nullable: true }).isString().trim(),
  body('min_value').optional({ nullable: true }).isNumeric(),
  body('max_value').optional({ nullable: true }).isNumeric(),
  body('description').optional({ nullable: true }).isString().trim(),
  validate,
  async (req, res) => {
    try {
      // Verify device belongs to user
      const { data: device, error: deviceError } = await req.supabase
        .from('devices')
        .select('id')
        .eq('id', req.params.id)
        .single();

      if (deviceError || !device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const { channel_name, channel_type, data_type, unit, min_value, max_value, description } = req.body;

      const { data, error } = await req.supabase
        .from('device_channels')
        .insert({
          device_id: req.params.id,
          channel_name,
          channel_type,
          data_type,
          unit: unit || null,
          min_value: min_value ?? null,
          max_value: max_value ?? null,
          description: description || null,
        })
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({ channel: data });
    } catch (err) {
      console.error('Error creating channel:', err);
      res.status(500).json({ error: 'Failed to create channel' });
    }
  }
);

/**
 * PATCH /api/devices/:id/channels/:channelId
 * Update a channel
 */
router.patch('/:id/channels/:channelId',
  param('id').isUUID(),
  param('channelId').isUUID(),
  body('channel_name').optional().isString().trim().isLength({ min: 1, max: 50 }),
  body('channel_type').optional().isIn(['control', 'sensor']),
  body('data_type').optional().isIn(['toggle', 'slider', 'input', 'number', 'text']),
  body('unit').optional({ nullable: true }).isString().trim(),
  body('min_value').optional({ nullable: true }).isNumeric(),
  body('max_value').optional({ nullable: true }).isNumeric(),
  body('description').optional({ nullable: true }).isString().trim(),
  validate,
  async (req, res) => {
    try {
      const updates = {};
      const fields = ['channel_name', 'channel_type', 'data_type', 'unit', 'min_value', 'max_value', 'description'];
      fields.forEach(f => {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      });

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const { data, error } = await req.supabase
        .from('device_channels')
        .update(updates)
        .eq('id', req.params.channelId)
        .eq('device_id', req.params.id)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Channel not found' });
        }
        throw error;
      }

      res.json({ channel: data });
    } catch (err) {
      console.error('Error updating channel:', err);
      res.status(500).json({ error: 'Failed to update channel' });
    }
  }
);

/**
 * DELETE /api/devices/:id/channels/:channelId
 * Delete a channel
 */
router.delete('/:id/channels/:channelId',
  param('id').isUUID(),
  param('channelId').isUUID(),
  validate,
  async (req, res) => {
    try {
      const { error } = await req.supabase
        .from('device_channels')
        .delete()
        .eq('id', req.params.channelId)
        .eq('device_id', req.params.id);

      if (error) throw error;

      res.status(204).send();
    } catch (err) {
      console.error('Error deleting channel:', err);
      res.status(500).json({ error: 'Failed to delete channel' });
    }
  }
);

module.exports = router;