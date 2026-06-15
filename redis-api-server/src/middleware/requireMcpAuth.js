const mcpControl = require('../services/mcp-control');

module.exports = async function requireMcpAuth(req, res, next) {
  try {
    req.mcpClient = await mcpControl.authenticateBearer(req.headers.authorization || '');
    return next();
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'Unauthorized' });
  }
};
