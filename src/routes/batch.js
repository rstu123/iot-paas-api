const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { supabaseAdmin } = require('../services/supabase');
const { attachTier } = require('../middleware/subscription');
const mqttService = require('../services/mqtt');
const archiver = require('archiver');

const router = express.Router();
router.use(authenticate);

router.use(attachTier);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ─── Arduino sketch templates ───

function generateESP32Sketch(device, userId, projectId, wifiSSID, wifiPassword) {
  return `// ═══════════════════════════════════════════════════
// IoTPaaS - Auto-generated firmware
// Device: ${device.name}
// Board:  ESP32
// ═══════════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

// ─── WiFi Configuration ───
#define WIFI_SSID     "${wifiSSID}"
#define WIFI_PASSWORD "${wifiPassword}"

// ─── MQTT Configuration (auto-filled) ───
#define MQTT_HOST     "${process.env.MQTT_HOST || 'mqtt.iot-paas.io.vn'}"
#define MQTT_PORT     1883
#define MQTT_USER     "${device.id}"
#define MQTT_PASS     "${device.device_token}"

// ─── Topic Paths (auto-filled) ───
#define TOPIC_BASE    "u/${userId}/d/${device.id}"
#define TOPIC_BCAST   "u/${userId}/p/${projectId}/broadcast"

// ─── Pin Configuration ───
#define DHT_PIN       15
#define DHT_TYPE      DHT11
#define RELAY1_PIN    17
#define RELAY2_PIN    16
#define PIR_PIN       33
#define LDR_PIN       32

// ─── Objects ───
WiFiClient espClient;
PubSubClient mqtt(espClient);
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastPublish = 0;
const long publishInterval = 5000;

// ─── MQTT Callback ───
void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  
  String topicStr = String(topic);
  Serial.printf("[MQTT] %s => %s\\n", topic, msg.c_str());

  // Extract channel name (last segment of topic)
  // Works for both individual and broadcast topics
  String channel = "";
  int lastSlash = topicStr.lastIndexOf('/');
  if (lastSlash >= 0) channel = topicStr.substring(lastSlash + 1);

  if (channel == "relay1") {
    digitalWrite(RELAY1_PIN, msg == "1" || msg == "true" ? HIGH : LOW);
    Serial.printf("[Relay1] %s\\n", msg.c_str());
  } else if (channel == "relay2") {
    digitalWrite(RELAY2_PIN, msg == "1" || msg == "true" ? HIGH : LOW);
    Serial.printf("[Relay2] %s\\n", msg.c_str());
  }
}

// ─── WiFi Connect ───
void setupWiFi() {
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\\nConnected! IP: %s\\n", WiFi.localIP().toString().c_str());
}

// ─── MQTT Connect ───
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("Connecting MQTT...");
    if (mqtt.connect(MQTT_USER, MQTT_USER, MQTT_PASS)) {
      Serial.println("connected!");
      // Subscribe to individual device commands
      mqtt.subscribe(TOPIC_BASE "/in/+");
      // Subscribe to project-wide broadcast commands
      mqtt.subscribe(TOPIC_BCAST "/+");
      Serial.println("Subscribed to individual + broadcast topics");
    } else {
      Serial.printf("failed (rc=%d), retrying in 5s...\\n", mqtt.state());
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  
  // Relay pins
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  digitalWrite(RELAY1_PIN, LOW);
  digitalWrite(RELAY2_PIN, LOW);

  // Sensor pins
  pinMode(PIR_PIN, INPUT);

  dht.begin();
  setupWiFi();
  
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(callback);
  connectMQTT();

  Serial.println("═══════════════════════════════");
  Serial.println("  IoTPaaS Device Ready");
  Serial.printf("  Device: %s\\n", "${device.name}");
  Serial.printf("  Board:  ESP32\\n");
  Serial.println("═══════════════════════════════");
}

void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  if (millis() - lastPublish >= publishInterval) {
    lastPublish = millis();

    // ─── DHT11: Temperature & Humidity ───
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();

    if (!isnan(temp)) {
      mqtt.publish(TOPIC_BASE "/out/temperature", String(temp, 1).c_str());
      Serial.printf("[Sensor] Temperature: %.1f C\\n", temp);
    }
    if (!isnan(hum)) {
      mqtt.publish(TOPIC_BASE "/out/humidity", String(hum, 1).c_str());
      Serial.printf("[Sensor] Humidity: %.1f %%\\n", hum);
    }

    // ─── LDR: Light Level ───
    int ldr = analogRead(LDR_PIN);
    mqtt.publish(TOPIC_BASE "/out/light", String(ldr).c_str());
    Serial.printf("[Sensor] Light: %d\\n", ldr);

    // ─── PIR: Motion Detection ───
    int pir = digitalRead(PIR_PIN);
    mqtt.publish(TOPIC_BASE "/out/motion", String(pir).c_str());
    Serial.printf("[Sensor] Motion: %d\\n", pir);
  }
}
`;
}

function generateESP8266Sketch(device, userId, projectId, wifiSSID, wifiPassword) {
  return `// ═══════════════════════════════════════════════════
// IoTPaaS - Auto-generated firmware
// Device: ${device.name}
// Board:  ESP8266
// ═══════════════════════════════════════════════════

#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

// ─── WiFi Configuration ───
#define WIFI_SSID     "${wifiSSID}"
#define WIFI_PASSWORD "${wifiPassword}"

// ─── MQTT Configuration (auto-filled) ───
#define MQTT_HOST     "${process.env.MQTT_HOST || 'mqtt.iot-paas.io.vn'}"
#define MQTT_PORT     1883
#define MQTT_USER     "${device.id}"
#define MQTT_PASS     "${device.device_token}"

// ─── Topic Paths (auto-filled) ───
#define TOPIC_BASE    "u/${userId}/d/${device.id}"
#define TOPIC_BCAST   "u/${userId}/p/${projectId}/broadcast"

// ─── Pin Configuration ───
#define DHT_PIN       D6
#define DHT_TYPE      DHT11
#define RELAY1_PIN    D0   // GPIO16
#define RELAY2_PIN    D4   // GPIO2
#define PIR_PIN       D5
#define LDR_PIN       D7

// ─── Objects ───
WiFiClient espClient;
PubSubClient mqtt(espClient);
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastPublish = 0;
const long publishInterval = 5000;

// ─── MQTT Callback ───
void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  
  String topicStr = String(topic);
  Serial.printf("[MQTT] %s => %s\\n", topic, msg.c_str());

  String channel = "";
  int lastSlash = topicStr.lastIndexOf('/');
  if (lastSlash >= 0) channel = topicStr.substring(lastSlash + 1);

  if (channel == "relay1") {
    digitalWrite(RELAY1_PIN, msg == "1" || msg == "true" ? HIGH : LOW);
    Serial.printf("[Relay1] %s\\n", msg.c_str());
  } else if (channel == "relay2") {
    digitalWrite(RELAY2_PIN, msg == "1" || msg == "true" ? HIGH : LOW);
    Serial.printf("[Relay2] %s\\n", msg.c_str());
  }
}

// ─── WiFi Connect ───
void setupWiFi() {
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\\nConnected! IP: %s\\n", WiFi.localIP().toString().c_str());
}

// ─── MQTT Connect ───
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("Connecting MQTT...");
    if (mqtt.connect(MQTT_USER, MQTT_USER, MQTT_PASS)) {
      Serial.println("connected!");
      mqtt.subscribe(TOPIC_BASE "/in/+");
      mqtt.subscribe(TOPIC_BCAST "/+");
      Serial.println("Subscribed to individual + broadcast topics");
    } else {
      Serial.printf("failed (rc=%d), retrying in 5s...\\n", mqtt.state());
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  
  // Relay pins
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  digitalWrite(RELAY1_PIN, LOW);
  digitalWrite(RELAY2_PIN, LOW);

  // Sensor pins
  pinMode(PIR_PIN, INPUT);

  dht.begin();
  setupWiFi();
  
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(callback);
  connectMQTT();

  Serial.println("═══════════════════════════════");
  Serial.println("  IoTPaaS Device Ready");
  Serial.printf("  Device: %s\\n", "${device.name}");
  Serial.printf("  Board:  ESP8266\\n");
  Serial.println("═══════════════════════════════");
}

void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  if (millis() - lastPublish >= publishInterval) {
    lastPublish = millis();

    // ─── DHT11: Temperature & Humidity ───
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();

    if (!isnan(temp)) {
      mqtt.publish(TOPIC_BASE "/out/temperature", String(temp, 1).c_str());
      Serial.printf("[Sensor] Temperature: %.1f C\\n", temp);
    }
    if (!isnan(hum)) {
      mqtt.publish(TOPIC_BASE "/out/humidity", String(hum, 1).c_str());
      Serial.printf("[Sensor] Humidity: %.1f %%\\n", hum);
    }

    // ─── LDR: Light Level ───
    int ldr = digitalRead(LDR_PIN);
    mqtt.publish(TOPIC_BASE "/out/light", String(ldr).c_str());
    Serial.printf("[Sensor] Light: %d\\n", ldr);

    // ─── PIR: Motion Detection ───
    int pir = digitalRead(PIR_PIN);
    mqtt.publish(TOPIC_BASE "/out/motion", String(pir).c_str());
    Serial.printf("[Sensor] Motion: %d\\n", pir);
  }
}
`;
}

// ═══════════════════════════════════════════════════
// ENDPOINT 1: Batch Create Devices
// POST /api/batch/projects/:id/devices
// Body: { count: 1-100, hardware_type: "ESP32"|"ESP8266", name_prefix?: string }
// ═══════════════════════════════════════════════════
router.post('/projects/:id/devices',
  param('id').isUUID(),
  body('count').isInt({ min: 1, max: 100 }),
  body('hardware_type').isIn(['ESP32', 'ESP8266']),
  body('name_prefix').optional().isString().trim().isLength({ min: 1, max: 50 }),
  validate,
  async (req, res) => {
    try {
      const projectId = req.params.id;
      const { count, hardware_type, name_prefix } = req.body;
      const prefix = name_prefix || `${hardware_type}-Device`;

      // Verify project belongs to user
      const { data: project, error: projectError } = await req.supabase
        .from('projects')
        .select('id, user_id')
        .eq('id', projectId)
        .single();

      if (projectError || !project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Get current device count to continue numbering
      const { count: existingCount } = await req.supabase
        .from('devices')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId);

	// ─── Tier enforcement ───
      if (!req.limits.allowed_project_types.includes('batch')) {
        return res.status(403).json({
          error: 'Batch device creation requires a paid subscription',
          tier: req.tier,
        });
      }

      const startNum = (existingCount || 0) + 1;

      // Generate all devices
      const devices = [];
      for (let i = 0; i < count; i++) {
        const { data: tokenResult } = await supabaseAdmin.rpc('generate_device_token');
        devices.push({
          project_id: projectId,
          name: `${prefix} #${String(startNum + i).padStart(3, '0')}`,
          hardware_type,
          device_token: tokenResult,
        });
      }

      // Batch insert
      const { data, error } = await req.supabase
        .from('devices')
        .insert(devices)
        .select();

      if (error) throw error;

      res.status(201).json({
        message: `${count} devices created successfully`,
        count: data.length,
        devices: data,
      });
    } catch (err) {
      console.error('Error batch creating devices:', err);
      res.status(500).json({ error: 'Failed to batch create devices' });
    }
  }
);

// ═══════════════════════════════════════════════════
// ENDPOINT 2: Download Firmware Pack (ZIP)
// POST /api/batch/projects/:id/firmware-pack
// Body: { wifi_ssid: string, wifi_password: string }
// Changed to POST so WiFi credentials stay in request body, not URL
// ═══════════════════════════════════════════════════
router.post('/projects/:id/firmware-pack',
  param('id').isUUID(),
  body('wifi_ssid').isString().trim().isLength({ min: 1, max: 64 }),
  body('wifi_password').isString().trim().isLength({ min: 0, max: 64 }),
  validate,
  async (req, res) => {
    try {
      const projectId = req.params.id;
      const { wifi_ssid, wifi_password } = req.body;

      // Get project with user_id
      const { data: project, error: projectError } = await req.supabase
        .from('projects')
        .select('id, name, slug, user_id')
        .eq('id', projectId)
        .single();

      if (projectError || !project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Get all devices in this project (need tokens for credentials)
      const { data: devices, error: devicesError } = await req.supabase
        .from('devices')
        .select('id, name, hardware_type, device_token')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (devicesError) throw devicesError;

      if (!devices || devices.length === 0) {
        return res.status(400).json({ error: 'No devices in this project' });
      }

      // Set response headers for ZIP download
      const zipName = `${project.slug || 'firmware'}-pack.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

      // Create ZIP archive
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(res);

      archive.on('error', (err) => {
        console.error('Archive error:', err);
        res.status(500).end();
      });

      // Generate one .ino file per device
      for (let i = 0; i < devices.length; i++) {
        const device = devices[i];
        const num = String(i + 1).padStart(3, '0');
        const folderName = `device_${num}_${device.hardware_type}`;

        let sketch;
        if (device.hardware_type === 'ESP8266') {
          sketch = generateESP8266Sketch(device, project.user_id, projectId, wifi_ssid, wifi_password);
        } else {
          sketch = generateESP32Sketch(device, project.user_id, projectId, wifi_ssid, wifi_password);
        }

        // Arduino IDE requires .ino filename to match folder name
        archive.append(sketch, { name: `${folderName}/${folderName}.ino` });
      }

      // Add a README
      const readme = `IoTPaaS Firmware Pack
=====================
Project: ${project.name}
Devices: ${devices.length}
WiFi Network: ${wifi_ssid}
Generated: ${new Date().toISOString()}

Instructions:
1. Open each folder in Arduino IDE
2. WiFi credentials are already configured
3. Select the correct board type for each device
4. Upload to each device

Each device has unique MQTT credentials pre-filled.
All devices subscribe to both individual AND broadcast topics,
so you can control them all at once from the dashboard.

Sensors included: DHT11 (temperature + humidity), PIR (motion), LDR (light)
Controls included: Relay 1, Relay 2

Individual topic pattern: u/{user_id}/d/{device_id}/in/{channel}
Broadcast topic pattern:  u/{user_id}/p/{project_id}/broadcast/{channel}
`;
      archive.append(readme, { name: 'README.txt' });

      await archive.finalize();
    } catch (err) {
      console.error('Error generating firmware pack:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to generate firmware pack' });
      }
    }
  }
);

// ═══════════════════════════════════════════════════
// ENDPOINT 3: Broadcast Control
// POST /api/batch/projects/:id/broadcast
// Body: { channel: "relay1", payload: "true" }
// ═══════════════════════════════════════════════════
router.post('/projects/:id/broadcast',
  param('id').isUUID(),
  body('channel').isString().trim().isLength({ min: 1, max: 50 }),
  body('payload').isString().trim(),
  validate,
  async (req, res) => {
    try {
      const projectId = req.params.id;
      const { channel, payload } = req.body;

      // Get project to verify ownership and get user_id
      const { data: project, error: projectError } = await req.supabase
        .from('projects')
        .select('id, user_id')
        .eq('id', projectId)
        .single();

      if (projectError || !project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Publish broadcast via the shared MQTT service
      const status = mqttService.getStatus();
      if (!status.connected) {
        return res.status(503).json({ error: 'MQTT broker not available, try again' });
      }

      await mqttService.publishBroadcast(project.user_id, projectId, channel, payload);

      const topic = `u/${project.user_id}/p/${projectId}/broadcast/${channel}`;

      res.json({
        success: true,
        topic,
        channel,
        payload,
        message: 'Broadcast sent to all devices in project',
      });
    } catch (err) {
      console.error('Error broadcasting:', err);
      res.status(500).json({ error: 'Failed to broadcast' });
    }
  }
);

module.exports = router;
