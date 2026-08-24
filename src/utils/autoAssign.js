const User = require('../models/User');
const Role = require('../models/Role');
const Lead = require('../models/Lead');
const { OPEN_STAGES } = require('../config/crm.constants');

/**
 * Picks the active Sales Agent currently carrying the fewest open leads —
 * a simple load-balanced round robin for leads that arrive automatically
 * via webhook (Facebook/Google/WhatsApp), where there's no human picking
 * who it goes to. Returns null (lead stays unassigned) if there are no
 * active Sales Agents yet, so setup order never breaks lead capture.
 */
const pickLeastLoadedAgent = async () => {
  const agentRole = await Role.findOne({ slug: 'sales-agent' }).select('_id');
  if (!agentRole) return null;

  const agents = await User.find({ role: agentRole._id, status: 'active' }).select('_id');
  if (agents.length === 0) return null;

  const loads = await Promise.all(
    agents.map(async (agent) => ({
      agentId: agent._id,
      openLeads: await Lead.countDocuments({ assignedTo: agent._id, stage: { $in: OPEN_STAGES } }),
    }))
  );

  loads.sort((a, b) => a.openLeads - b.openLeads);
  return loads[0].agentId;
};

module.exports = { pickLeastLoadedAgent };
