/**
 * Subscription Tier Limits
 * 
 * Single source of truth for all tier restrictions.
 * To change limits, edit the numbers here — everything else reads from this file.
 */

const TIER_LIMITS = {
  free: {
    max_projects: 3,
    max_devices_per_project: 5,
    allowed_project_types: ['normal'],
    label: 'Free',
  },
  paid: {
    max_projects: Infinity,
    max_devices_per_project: Infinity,
    allowed_project_types: ['normal', 'batch'],
    label: 'Paid',
  },
};

function getLimits(tier) {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

module.exports = { TIER_LIMITS, getLimits };
