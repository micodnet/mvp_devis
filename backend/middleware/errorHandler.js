// express/middleware/errorHandler.js
const { AppError } = require('../errors/AppError');

/**
 * Wrapper pour éviter les try/catch partout dans les routes.
 * Usage : router.get("/x", asyncHandler(async (req, res) => {...}))
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Middleware d'erreur global. À monter EN DERNIER dans server.js.
 */
function errorHandler(err, req, res, _next) {
  const status = err.status || 500;

  if (!err.isOperational) {
    // Erreur inattendue → log complet
    console.error("[UNHANDLED]", err);
  }

  res.status(status).json({
    error: err.message || "Erreur serveur",
    ...(err.code ? { code: err.code } : {}),
  });
}

module.exports = { asyncHandler, errorHandler }