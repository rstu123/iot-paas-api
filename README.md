# IoT PaaS Platform API

Backend API for the IoT Platform-as-a-Service project.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Edit .env with your Supabase credentials
# Get these from: Supabase Dashboard > Settings > API

# 4. Run in development mode
npm run dev
```

## Project Structure

```
iot-paas-api/
├── config/
│   └── index.js          # Environment config
├── src/
│   ├── index.js          # App entry point
│   ├── middleware/
│   │   └── auth.js       # JWT authentication
│   ├── routes/
│   │   ├── projects.js   # /api/projects
│   │   ├── devices.js    # /api/devices
│   │   └── provision.js  # /api/provision (Week 3)
│   ├── services/
│   │   └── supabase.js   # Supabase client
│   └── utils/
├── .env.example
└── package.json
```

## API Endpoints

### Authentication

All endpoints except `/api/provision` and `/health` require a valid Supabase JWT in the Authorization header:

```
Authorization: Bearer <supabase-access-token>
```

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:id` | Get single project |
| POST | `/api/projects` | Create project |
| PATCH | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |

**Create Project Request:**
```json
{
  "name": "Smart Home",
  "slug": "smart-home",
  "description": "Home automation project"
}
```

### Devices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List all devices |
| GET | `/api/devices?project_id=xxx` | List devices in project |
| GET | `/api/devices/:id` | Get device with channels |
| POST | `/api/devices` | Create device |
| PATCH | `/api/devices/:id` | Update device |
| DELETE | `/api/devices/:id` | Delete device |
| POST | `/api/devices/:id/regenerate-token` | New token |

**Create Device Request:**
```json
{
  "project_id": "uuid-here",
  "name": "Living Room Plug",
  "hardware_type": "ESP32"
}
```

**Create Device Response:**
```json
{
  "device": {
    "id": "device-uuid",
    "name": "Living Room Plug",
    "device_token": "abc123...",
    "..."
  },
  "message": "Save this device_token! It will not be shown again."
}
```

### Provisioning (Week 3)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/provision` | Exchange token for MQTT creds |

**Provision Request (from ESP32):**
```json
{
  "device_token": "abc123...",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "firmware_version": "1.0.0"
}
```

## Testing with cURL

```bash
# Health check
curl http://localhost:3000/health

# Login (get token from Supabase)
# Use the token in subsequent requests

# Create project
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name": "Test Project"}'

# List projects
curl http://localhost:3000/api/projects \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create device
curl -X POST http://localhost:3000/api/devices \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"project_id": "PROJECT_UUID", "name": "Test Device"}'
```

## Week 1 Checklist

- [x] Database schema deployed
- [x] User auth via Supabase
- [x] Basic API structure
- [x] Projects CRUD
- [x] Devices CRUD
- [ ] Test all endpoints

## Next Steps (Week 2)

- [ ] Set up EMQX Cloud
- [ ] Configure JWT auth hook
- [ ] Implement ACL rules
- [ ] Complete provisioning endpoint
