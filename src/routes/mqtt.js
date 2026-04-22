/**
 * MQTT Authentication & Authorization Routes
 * 
 * Handles both DEVICE and USER authentication for EMQX broker.
 * 
 * Device Auth: username = device_id, password = device_token
 * User Auth:   username = user_id,   password = JWT (verified via Supabase API)
 * 
 * Topic patterns:
 *   Individual:      u/{user_id}/d/{device_id}/{in|out}/{channel}
 *   Broadcast:       u/{user_id}/p/{project_id}/broadcast/{channel}
 *   User wildcard:   u/{user_id}/d/+/out/+  (subscribe only, for batch monitoring)
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../services/supabase');
const config = require('../../config');

// UUID validation helper
function isUUID(str) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
}

/**
 * Verify JWT by calling Supabase Auth API
 * Returns user data if valid, null if invalid
 */
async function verifySupabaseJWT(token) {
    try {
        const response = await fetch(`${config.supabase.url}/auth/v1/user`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'apikey': config.supabase.anonKey
            }
        });
        
        if (response.ok) {
            const user = await response.json();
            return user;
        }
        return null;
    } catch (error) {
        console.error('[MQTT Auth] Supabase verify error:', error.message);
        return null;
    }
}

/**
 * Parse topic into a structured object
 * Supports individual, broadcast, and wildcard topic patterns
 * 
 * Individual: u/{user_id}/d/{device_id}/{direction}/{channel}
 *   → { type: 'device', userId, deviceId, direction, channel }
 * 
 * Broadcast: u/{user_id}/p/{project_id}/broadcast/{channel}
 *   → { type: 'broadcast', userId, projectId, channel }
 * 
 * User wildcard: u/{user_id}/d/+/out/+ or u/{user_id}/d/+/out/#
 *   → { type: 'user_wildcard', userId }
 *   (EMQX sends the literal '+' and '#' chars when checking subscribe ACL)
 * 
 * Returns null if topic format is unrecognized
 */
function parseTopic(topic) {
    const parts = topic.split('/');

    // Individual device topic: u/{uid}/d/{did}/{dir}/{ch} — 6 parts
    if (parts.length === 6 && parts[0] === 'u' && parts[2] === 'd') {
        // Check for wildcard subscription: u/{uid}/d/+/out/+
        if (parts[3] === '+' && parts[4] === 'out' && parts[5] === '+') {
            return {
                type: 'user_wildcard',
                userId: parts[1],
                direction: 'out',
            };
        }

        return {
            type: 'device',
            userId: parts[1],
            deviceId: parts[3],
            direction: parts[4],
            channel: parts[5],
        };
    }

    // User wildcard with # at end: u/{uid}/d/+/out/#  — 6 parts
    if (parts.length === 6 && parts[0] === 'u' && parts[2] === 'd' && parts[3] === '+' && parts[5] === '#') {
        return {
            type: 'user_wildcard',
            userId: parts[1],
            direction: parts[4],
        };
    }

    // Broadcast topic: u/{uid}/p/{pid}/broadcast/{ch} — 6 parts
    if (parts.length === 6 && parts[0] === 'u' && parts[2] === 'p' && parts[4] === 'broadcast') {
        return {
            type: 'broadcast',
            userId: parts[1],
            projectId: parts[3],
            channel: parts[5],
        };
    }

    return null;
}

/**
 * POST /api/mqtt/auth
 * EMQX calls this to authenticate clients (devices or users)
 */
router.post('/auth', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            console.log('[MQTT Auth] Missing credentials');
            return res.status(400).json({ result: 'deny' });
        }

        // Platform API client authentication (for OTA publishing, broadcast, etc.)
        if (username === config.mqtt.platformUser && password === config.mqtt.platformPassword) {
            console.log('[MQTT Auth] Platform API authenticated');
            return res.status(200).json({ result: 'allow', is_superuser: true });
        }

        // Check if username is a valid UUID
        if (!isUUID(username)) {
            console.log('[MQTT Auth] Invalid username format:', username);
            return res.status(401).json({ result: 'deny' });
        }

        // Try DEVICE authentication first
        const { data: device, error: deviceError } = await supabaseAdmin
            .from('devices')
            .select('id, device_token, project:projects!inner(user_id)')
            .eq('id', username)
            .single();

        if (device && device.device_token === password) {
            console.log('[MQTT Auth] Device authenticated:', username);
            return res.status(200).json({ 
                result: 'allow',
                is_superuser: false
            });
        }

        // Try USER authentication (JWT via Supabase API)
        const user = await verifySupabaseJWT(password);
        
        if (user && user.id === username) {
            console.log('[MQTT Auth] User authenticated:', username);
            return res.status(200).json({ 
                result: 'allow',
                is_superuser: false
            });
        }

        console.log('[MQTT Auth] Authentication failed for:', username);
        return res.status(401).json({ result: 'deny' });

    } catch (err) {
        console.error('[MQTT Auth] Error:', err.message);
        return res.status(500).json({ result: 'deny' });
    }
});

/**
 * POST /api/mqtt/acl
 * EMQX calls this to authorize pub/sub actions
 */
router.post('/acl', async (req, res) => {
    try {
        const { username, topic, action } = req.body;

        if (!username || !topic || !action) {
            return res.status(400).json({ result: 'deny' });
        }

        // Parse the topic
        const parsed = parseTopic(topic);
        if (!parsed) {
            console.log('[MQTT ACL] Unrecognized topic format:', topic);
            return res.status(200).json({ result: 'deny' });
        }

        // ─────────────────────────────────────────────
        // USER WILDCARD: u/{uid}/d/+/out/+
        // Only users can subscribe (for batch device monitoring)
        // ─────────────────────────────────────────────
        if (parsed.type === 'user_wildcard') {
            // Only allow subscribe, only for 'out' direction
            if (action === 'subscribe' && parsed.direction === 'out' && parsed.userId === username) {
                console.log(`[MQTT ACL] ALLOW user ${username} wildcard subscribe ${topic}`);
                return res.status(200).json({ result: 'allow' });
            }

            console.log(`[MQTT ACL] DENY ${action} wildcard ${topic} for ${username}`);
            return res.status(200).json({ result: 'deny' });
        }

        // ─────────────────────────────────────────────
        // BROADCAST TOPIC: u/{uid}/p/{pid}/broadcast/{ch}
        // ─────────────────────────────────────────────
        if (parsed.type === 'broadcast') {
            // First check if username is a DEVICE
            const { data: device } = await supabaseAdmin
                .from('devices')
                .select('id, project_id, project:projects!inner(user_id)')
                .eq('id', username)
                .single();

            if (device) {
                // Device can SUBSCRIBE to broadcast of its own project
                const isOwnProject = device.project_id === parsed.projectId;
                const isOwnOwner = device.project.user_id === parsed.userId;

                if (action === 'subscribe' && isOwnProject && isOwnOwner) {
                    console.log(`[MQTT ACL] ALLOW device ${username} subscribe broadcast ${topic}`);
                    return res.status(200).json({ result: 'allow' });
                }

                console.log(`[MQTT ACL] DENY device ${username} ${action} broadcast ${topic}`);
                return res.status(200).json({ result: 'deny' });
            }

            // User can PUBLISH to broadcast of their own projects
            if (parsed.userId === username && action === 'publish') {
                const { data: project } = await supabaseAdmin
                    .from('projects')
                    .select('id, user_id')
                    .eq('id', parsed.projectId)
                    .eq('user_id', username)
                    .single();

                if (project) {
                    console.log(`[MQTT ACL] ALLOW user ${username} publish broadcast ${topic}`);
                    return res.status(200).json({ result: 'allow' });
                }
            }

            // User can also SUBSCRIBE to broadcast of their own projects
            if (parsed.userId === username && action === 'subscribe') {
                const { data: project } = await supabaseAdmin
                    .from('projects')
                    .select('id, user_id')
                    .eq('id', parsed.projectId)
                    .eq('user_id', username)
                    .single();

                if (project) {
                    console.log(`[MQTT ACL] ALLOW user ${username} subscribe broadcast ${topic}`);
                    return res.status(200).json({ result: 'allow' });
                }
            }

            console.log(`[MQTT ACL] DENY ${action} broadcast ${topic} for ${username}`);
            return res.status(200).json({ result: 'deny' });
        }

        // ─────────────────────────────────────────────
        // DEVICE TOPIC: u/{uid}/d/{did}/{dir}/{ch}
        // ─────────────────────────────────────────────

        // First, check if username is a DEVICE
        const { data: device, error: deviceError } = await supabaseAdmin
            .from('devices')
            .select('id, project:projects!inner(user_id)')
            .eq('id', username)
            .single();

        if (device) {
            // ===== DEVICE ACL =====
            const ownerId = device.project.user_id;
            const deviceId = device.id;

            let allowed = false;

            // Device can PUBLISH to: u/{owner}/d/{self}/out/{channel}
            if (action === 'publish' && 
                parsed.userId === ownerId && 
                parsed.deviceId === deviceId && 
                parsed.direction === 'out') {
                allowed = true;
            }

            // Device can SUBSCRIBE to: u/{owner}/d/{self}/in/{channel}
            if (action === 'subscribe' && 
                parsed.userId === ownerId && 
                parsed.deviceId === deviceId && 
                parsed.direction === 'in') {
                allowed = true;
            }

            if (allowed) {
                console.log(`[MQTT ACL] ALLOW ${action} ${topic} for device ${deviceId}`);
                return res.status(200).json({ result: 'allow' });
            }

            console.log(`[MQTT ACL] DENY ${action} ${topic} for device ${deviceId}`);
            return res.status(200).json({ result: 'deny' });
        }

        // ===== USER ACL =====
        const { data: ownedDevice, error: ownershipError } = await supabaseAdmin
            .from('devices')
            .select('id, project:projects!inner(user_id)')
            .eq('id', parsed.deviceId)
            .single();

        if (!ownedDevice) {
            console.log(`[MQTT ACL] DENY ${action} ${topic} - device not found`);
            return res.status(200).json({ result: 'deny' });
        }

        const isOwner = ownedDevice.project.user_id === username;
        const topicMatchesUser = parsed.userId === username;

        if (!isOwner || !topicMatchesUser) {
            console.log(`[MQTT ACL] DENY ${action} ${topic} for user ${username} - not owner`);
            return res.status(200).json({ result: 'deny' });
        }

        let allowed = false;

        // User can PUBLISH to: u/{self}/d/{owned_device}/in/{channel}
        if (action === 'publish' && parsed.direction === 'in') {
            allowed = true;
        }

        // User can SUBSCRIBE to: u/{self}/d/{owned_device}/out/{channel}
        if (action === 'subscribe' && parsed.direction === 'out') {
            allowed = true;
        }

        if (allowed) {
            console.log(`[MQTT ACL] ALLOW ${action} ${topic} for user ${username}`);
            return res.status(200).json({ result: 'allow' });
        }

        console.log(`[MQTT ACL] DENY ${action} ${topic} for user ${username}`);
        return res.status(200).json({ result: 'deny' });

    } catch (err) {
        console.error('[MQTT ACL] Error:', err.message);
        return res.status(500).json({ result: 'deny' });
    }
});

router.post('/webhook', async (req, res) => {
  try {
    const { event, clientid } = req.body;
    
    console.log(`[MQTT Webhook] ${event} - Client: ${clientid}`);
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(clientid)) {
      return res.json({ ok: true });
    }
    
    if (event === 'client.connected') {
      await supabaseAdmin
        .from('devices')
        .update({ is_online: true, last_seen: new Date().toISOString() })
        .eq('id', clientid);
      console.log(`[MQTT Webhook] Device ${clientid} is now ONLINE`);
      
    } else if (event === 'client.disconnected') {
      setTimeout(async () => {
        try {
          const { data } = await supabaseAdmin
            .from('devices')
            .select('last_seen')
            .eq('id', clientid)
            .single();
          
          const lastSeen = new Date(data?.last_seen || 0).getTime();
          const now = Date.now();
          if (now - lastSeen > 5000) {
            await supabaseAdmin
              .from('devices')
              .update({ is_online: false })
              .eq('id', clientid);
            console.log(`[MQTT Webhook] Device ${clientid} is now OFFLINE`);
          } else {
            console.log(`[MQTT Webhook] Device ${clientid} reconnected, skipping offline`);
          }
        } catch (err) {
          console.error('[MQTT Webhook] Delayed disconnect error:', err);
        }
      }, 3000);
    }
    
    res.json({ ok: true });
  } catch (err) {
    console.error('[MQTT Webhook] Error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
