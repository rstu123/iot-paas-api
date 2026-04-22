/**
 * MQTT Client Service
 * 
 * Connects to EMQX as a "platform" client and publishes
 * messages to devices (OTA commands, broadcast, etc.)
 * 
 * Uses a dedicated platform account that has publish access
 * to all device topics.
 */
const mqtt = require('mqtt');
const config = require('../../config');

let client = null;
let isConnected = false;

/**
 * Initialize the MQTT client connection
 * Call this once at server startup
 */
function connect() {
  const brokerUrl = `mqtt://${config.mqtt.host}:${config.mqtt.port}`;
  
  console.log(`[MQTT Service] Connecting to ${brokerUrl}...`);

  client = mqtt.connect(brokerUrl, {
    clientId: `platform-api-${Date.now()}`,
    username: config.mqtt.platformUser,
    password: config.mqtt.platformPassword,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    isConnected = true;
    console.log('[MQTT Service] Connected to broker');
  });

  client.on('error', (err) => {
    console.error('[MQTT Service] Connection error:', err.message);
  });

  client.on('close', () => {
    isConnected = false;
    console.log('[MQTT Service] Disconnected from broker');
  });

  client.on('reconnect', () => {
    console.log('[MQTT Service] Reconnecting...');
  });

  return client;
}

/**
 * Publish a message to a device's command channel
 * @param {string} userId - Device owner's user ID
 * @param {string} deviceId - Target device ID
 * @param {string} channel - Command channel name (e.g., "relay1", "$ota")
 * @param {string|object} payload - Message payload (objects are JSON-stringified)
 */
function publishToDevice(userId, deviceId, channel, payload) {
  if (!client || !isConnected) {
    console.error('[MQTT Service] Cannot publish: not connected');
    return false;
  }

  const topic = `u/${userId}/d/${deviceId}/in/${channel}`;
  const message = typeof payload === 'object' ? JSON.stringify(payload) : payload;

  client.publish(topic, message, { qos: 1 }, (err) => {
    if (err) {
      console.error(`[MQTT Service] Publish failed [${topic}]:`, err.message);
    } else {
      console.log(`[MQTT Service] Published [${topic}]: ${message}`);
    }
  });

  return true;
}

/**
 * Publish a broadcast message to ALL devices in a project
 * @param {string} userId - Project owner's user ID
 * @param {string} projectId - Target project ID
 * @param {string} channel - Channel name (e.g., "relay1", "relay2")
 * @param {string|object} payload - Message payload
 * @returns {Promise<boolean>} - Resolves true on success
 */
function publishBroadcast(userId, projectId, channel, payload) {
  return new Promise((resolve, reject) => {
    if (!client || !isConnected) {
      console.error('[MQTT Service] Cannot broadcast: not connected');
      return reject(new Error('MQTT not connected'));
    }

    const topic = `u/${userId}/p/${projectId}/broadcast/${channel}`;
    const message = typeof payload === 'object' ? JSON.stringify(payload) : payload;

    client.publish(topic, message, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[MQTT Service] Broadcast failed [${topic}]:`, err.message);
        reject(err);
      } else {
        console.log(`[MQTT Service] Broadcast [${topic}]: ${message}`);
        resolve(true);
      }
    });
  });
}

/**
 * Check if the MQTT client is connected
 */
function getStatus() {
  return {
    connected: isConnected,
    clientId: client ? client.options.clientId : null,
  };
}

/**
 * Gracefully disconnect
 */
function disconnect() {
  if (client) {
    client.end();
    isConnected = false;
    console.log('[MQTT Service] Disconnected');
  }
}

module.exports = {
  connect,
  publishToDevice,
  publishBroadcast,
  getStatus,
  disconnect,
};
