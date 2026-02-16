"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = exports.errorHandler = void 0;
const logger_1 = require("../utils/logger");
const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    logger_1.logger.error({ message: err.message, stack: err.stack, statusCode, path: req.path, method: req.method });
    res.status(statusCode).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};
exports.errorHandler = errorHandler;
const asyncHandler = (fn) => {
    return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
};
exports.asyncHandler = asyncHandler;
//# sourceMappingURL=errorHandler.js.map