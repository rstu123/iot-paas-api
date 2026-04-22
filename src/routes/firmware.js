/**
 * Firmware / OTA Routes
 * 
 * Handles firmware upload to Supabase Storage and triggers
 * OTA updates to devices via MQTT.
 * 
 * Flow:
 * 1. User uploads .bin file via POST /api/devices/:id/firmware
 * 2. API stores it in Supabase Storage (firmware bucket)
 * 3. API publishes OTA command to device's $ota channel via MQTT
 * 4. Device downloads firmware via HTTPS and self-updates
 */

const express = require('express');
const { param, body, validationResult } = require('express-validator');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { supabaseAdmin } = require('../services/supabase');
const mqttService = require('../services/mqtt');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Configure multer for firmware uploads (max 2MB, memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    // Accept .bin files only
    if (file.originalname.endsWith('.bin') || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Only .bin firmware files are accepted'), false);
    }
  },
});

// Validation helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /api/devices/:id/firmware
 * Upload firmware and trigger OTA update
 * 
 * Body (multipart/form-data):
 *   - file: .bin firmware file
 *   - version: (optional) version string like "1.0.1"
 */
router.post('/:id/firmware',
  param('id').isUUID(),
  validate,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No firmware file uploaded. Send a .bin file as "file" field.' });
      }

      const deviceId = req.params.id;
      const version = req.body.version || 'unknown';

      // 1. Verify device belongs to user
      const { data: device, error: deviceError } = await req.supabase
        .from('devices')
        .select('id, name, project:projects!inner(user_id)')
        .eq('id', deviceId)
        .single();

      if (deviceError || !device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const userId = device.project.user_id;

      // 2. Upload firmware to Supabase Storage
      //    Path: firmware/{user_id}/{device_id}/{timestamp}.bin
      const timestamp = Date.now();
      const storagePath = `${userId}/${deviceId}/${timestamp}.bin`;

      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from('firmware')
        .upload(storagePath, req.file.buffer, {
          contentType: 'application/octet-stream',
          upsert: false,
        });

      if (uploadError) {
        console.error('[Firmware] Upload error:', uploadError);
        return res.status(500).json({ error: 'Failed to upload firmware to storage' });
      }

      // 3. Get public URL for the firmware file
      const { data: urlData } = supabaseAdmin.storage
        .from('firmware')
        .getPublicUrl(storagePath);

      const firmwareUrl = urlData.publicUrl;

      // 4. Publish OTA command to device via MQTT
      const otaCommand = {
        action: 'ota',
        url: firmwareUrl,
        version: version,
        size: req.file.size,
        timestamp: new Date().toISOString(),
      };

      const published = mqttService.publishToDevice(userId, deviceId, '$ota', otaCommand);

      if (!published) {
        // Firmware uploaded but MQTT publish failed — not critical
        console.warn('[Firmware] MQTT publish failed, device may not receive OTA command');
      }

      // 5. Optionally store firmware record in database for history
      // (We'll add a firmware_history table later if needed)

      console.log(`[Firmware] OTA triggered for device ${deviceId} (v${version}, ${req.file.size} bytes)`);

      res.status(200).json({
        message: 'Firmware uploaded and OTA command sent to device',
        firmware: {
          url: firmwareUrl,
          version: version,
          size: req.file.size,
          uploaded_at: new Date().toISOString(),
        },
        device: {
          id: device.id,
          name: device.name,
        },
        mqtt_published: published,
      });

    } catch (err) {
      console.error('[Firmware] Error:', err);
      res.status(500).json({ error: 'Failed to process firmware upload' });
    }
  }
);

/**
 * GET /api/devices/:id/firmware
 * List firmware files for a device
 */
router.get('/:id/firmware',
  param('id').isUUID(),
  validate,
  async (req, res) => {
    try {
      const deviceId = req.params.id;

      // Verify device belongs to user
      const { data: device, error: deviceError } = await req.supabase
        .from('devices')
        .select('id, project:projects!inner(user_id)')
        .eq('id', deviceId)
        .single();

      if (deviceError || !device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const userId = device.project.user_id;

      // List files in Supabase Storage
      const { data: files, error: listError } = await supabaseAdmin.storage
        .from('firmware')
        .list(`${userId}/${deviceId}`, {
          sortBy: { column: 'created_at', order: 'desc' },
        });

      if (listError) {
        console.error('[Firmware] List error:', listError);
        return res.status(500).json({ error: 'Failed to list firmware files' });
      }

      // Build response with public URLs
      const firmwareList = files.map(file => {
        const { data: urlData } = supabaseAdmin.storage
          .from('firmware')
          .getPublicUrl(`${userId}/${deviceId}/${file.name}`);

        return {
          name: file.name,
          size: file.metadata?.size || null,
          created_at: file.created_at,
          url: urlData.publicUrl,
        };
      });

      res.json({ firmware: firmwareList });

    } catch (err) {
      console.error('[Firmware] Error:', err);
      res.status(500).json({ error: 'Failed to fetch firmware list' });
    }
  }
);

module.exports = router;
