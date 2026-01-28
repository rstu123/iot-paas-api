const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../services/supabase');

const router = express.Router();

// Validation helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /api/provision
 * Device provisioning endpoint
 * 
 * Called by the ESP32 on first boot to exchange device_token for MQTT credentials.
 * 
 * Request body:
 * {
 *   "device_token": "abc123...",
 *   "mac_address": "AA:BB:CC:DD:EE:FF",
 *   "firmware_version": "1.0.0"
 * }
 * 
 * Response:
 * {
 *   "mqtt": {
 *     "host": "broker.emqx.io",
 *     "port": 8883,
 *     "username": "u_abc_d_xyz",
 *     "password": "generated-password",
 *     "client_id": "device-uuid"
 *   },
 *   "topics": {
 *     "command": "u/{user_id}/d/{device_id}/cmd/#",
 *     "state": "u/{user_id}/d/{device_id}/state/",
 *     "telemetry": "u/{user_id}/d/{device_id}/tel/"
 *   }
 * }
 * 
 * NOTE: This is a stub. Full implementation in Week 3.
 */
router.post('/',
  body('device_token').isString().isLength({ min: 64, max: 64 }),
  body('mac_address').optional().matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/),
  body('firmware_version').optional().isString(),
  validate,
  async (req, res) => {
    try {
      const { device_token, mac_address, firmware_version } = req.body;
      
      // Find device by token (using admin client to bypass RLS)
      const { data: device, error: findError } = await supabaseAdmin
        .from('devices')
        .select(`
          *,
          project:projects(user_id)
        `)
        .eq('device_token', device_token)
        .single();
      
      if (findError || !device) {
        return res.status(401).json({
          error: 'Invalid device token',
          message: 'Device not found or token is incorrect',
        });
      }
      
      // Check if already provisioned
      if (device.is_provisioned) {
        return res.status(409).json({
          error: 'Already provisioned',
          message: 'This device has already been provisioned. Use regenerate-token to re-provision.',
        });
      }
      
      // Generate MQTT credentials
      const mqttUsername = `u_${device.project.user_id.replace(/-/g, '').slice(0, 8)}_d_${device.id.replace(/-/g, '').slice(0, 8)}`;
      const mqttPassword = generateSecurePassword();
      
      // TODO Week 2: Register credentials with EMQX
      // await emqxService.createUser(mqttUsername, mqttPassword, device.id);
      
      // Update device with MQTT credentials
      const { error: updateError } = await supabaseAdmin
        .from('devices')
        .update({
          mqtt_username: mqttUsername,
          mqtt_password_hash: hashPassword(mqttPassword), // Store hash only
          mac_address,
          firmware_version,
          is_provisioned: true,
          provisioned_at: new Date().toISOString(),
        })
        .eq('id', device.id);
      
      if (updateError) throw updateError;
      
      // Build topic patterns
      const userId = device.project.user_id;
      const deviceId = device.id;
      const topicBase = `u/${userId}/d/${deviceId}`;
      
      // Return MQTT credentials to device
      res.json({
        mqtt: {
          host: process.env.EMQX_BROKER_HOST || 'broker.emqx.io', // TODO: Configure in Week 2
          port: 8883,
          username: mqttUsername,
          password: mqttPassword, // Only time plain password is sent!
          client_id: device.id,
          use_tls: true,
        },
        topics: {
          // Device subscribes to commands
          subscribe: `${topicBase}/cmd/#`,
          // Device publishes state updates
          state_prefix: `${topicBase}/state/`,
          // Device publishes telemetry
          telemetry_prefix: `${topicBase}/tel/`,
        },
        device: {
          id: device.id,
          name: device.name,
        },
      });
      
    } catch (err) {
      console.error('Provisioning error:', err);
      res.status(500).json({
        error: 'Provisioning failed',
        message: 'Internal server error during provisioning',
      });
    }
  }
);

/**
 * Generate a secure random password for MQTT
 */
function generateSecurePassword() {
  const crypto = require('crypto');
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Hash password for storage
 * TODO: Use bcrypt in production
 */
function hashPassword(password) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(password).digest('hex');
}

module.exports = router;
