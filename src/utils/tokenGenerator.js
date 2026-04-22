const crypto = require('crypto');

function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { generateDeviceToken };