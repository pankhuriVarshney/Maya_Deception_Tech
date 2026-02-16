import winston from 'winston';
const { combine, timestamp, json, errors, printf, colorize } = winston.format;

const consoleFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) msg += ` ${JSON.stringify(metadata)}`;
  if (stack) msg += `\n${stack}`;
  return msg;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'maya-dashboard' },
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true })),
  transports: [
    new winston.transports.Console({ format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), consoleFormat) }),
    new winston.transports.File({ filename: 'logs/combined.log', format: json() }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error', format: json() })
  ]
});