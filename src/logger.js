'use strict';
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const LOGS_DIR = path.resolve('logs');

const timestampFormat = winston.format.timestamp({
  format: 'YYYY-MM-DD HH:mm:ss',
});

const printFormat = winston.format.printf(({ timestamp, level, message, stack }) => {
  const base = `[${timestamp}] ${level.toUpperCase().padEnd(5)}: ${message}`;
  return stack ? `${base}\n${stack}` : base;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    timestampFormat,
    winston.format.errors({ stack: true }),
    printFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        timestampFormat,
        winston.format.errors({ stack: true }),
        printFormat
      ),
    }),
    new DailyRotateFile({
      dirname: LOGS_DIR,
      filename: 'bot-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info',
    }),
    new DailyRotateFile({
      dirname: LOGS_DIR,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
    }),
  ],
});

module.exports = logger;
