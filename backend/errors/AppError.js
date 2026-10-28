// express/errors/AppError.js
class AppError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.isOperational = true;
  }
}

const BadRequest = (msg, code) => new AppError(msg, 400, code);
const Unauthorized = (msg, code) => new AppError(msg, 401, code);
const Forbidden = (msg, code) => new AppError(msg, 403, code);
const NotFound = (msg, code) => new AppError(msg, 404, code);
const Conflict = (msg, code) => new AppError(msg, 409, code);

module.exports = { AppError, BadRequest, Unauthorized, Forbidden, NotFound, Conflict };