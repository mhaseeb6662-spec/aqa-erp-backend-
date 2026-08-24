/**
 * Sends a consistently-shaped JSON success response across the whole API:
 * { success, message, data, meta }
 */
const sendResponse = (res, statusCode, message, data = null, meta = null) => {
  const payload = { success: statusCode < 400, message };
  if (data !== null) payload.data = data;
  if (meta !== null) payload.meta = meta;
  return res.status(statusCode).json(payload);
};

module.exports = sendResponse;
