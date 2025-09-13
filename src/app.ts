// External Dependencies
import { config } from 'dotenv';
import express, { Application, Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import { PrismaClient } from './generated/prisma';
const prisma = new PrismaClient();

// Internal Dependencies
import userRouter from './routes/userRouter';
import pollRouter from './routes/pollRouter';
import { errorHandler } from './middleware/errorHandler';
import { setupWebSocket } from './websocket';
import logger from './utils/logger';

// Load environment variables
config({ path: '.env' });

// Type Declarations
declare global {
  namespace Express {
    interface Request {
      io?: SocketIOServer;
    }
  }
  
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT?: string;
      DATABASE_URL: string;
      JWT_SECRET: string;
      JWT_EXPIRES_IN?: string;
      ALLOWED_ORIGINS?: string;
      RATE_LIMIT_WINDOW_MS?: string;
      RATE_LIMIT_MAX?: string;
    }
  }
}

// Initialize Express
const app: Application = express();

// Create HTTP server
const httpServer: HttpServer = createServer(app);

// Initialize WebSocket server
const io = setupWebSocket(httpServer);
console.log('WebSocket server initialized');

// Make io accessible in routes
app.set('io', io);

// Attach io to request object
app.use((req: Request, res: Response, next: NextFunction) => {
  req.io = io;
  next();
});

// Export app and server for use in other files
export { app, httpServer, io };

// ======================
// Security Middleware
// ======================

// 1. Set security HTTP headers
app.use(helmet());

// 2. Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX || '100') // 100 requests per windowMs
});
app.use(limiter);

// 3. Enable CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ======================
// Request Parsing
// ======================

// 1. Request logger - First middleware to log all incoming requests
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`Incoming ${req.method} ${req.originalUrl}`);
  logger.debug('Request headers:', req.headers);
  logger.debug('Request body:', req.body);
  next();
});

// 2. Body parser
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 3. Cookie parser
app.use(cookieParser(process.env.JWT_SECRET));

// 3. Data sanitization - Simplified and more permissive
app.use((req: Request, res: Response, next: NextFunction) => {
  // Skip for WebSocket upgrade requests and non-JSON content
  if (req.headers.upgrade === 'websocket' || !req.is('application/json')) {
    return next();
  }
  
  // Only validate JSON content type for POST, PUT, PATCH requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    try {
      // If body is already parsed, continue
      if (req.body && typeof req.body === 'object') {
        // Simple validation for common NoSQL injection patterns
        const bodyStr = JSON.stringify(req.body);
        if (bodyStr.includes('$where') || bodyStr.includes('$ne') || bodyStr.includes('$regex')) {
          return res.status(400).json({
            success: false,
            message: 'Invalid characters in request body'
          });
        }
      }
    } catch (error) {
      console.error('Error processing request body:', error);
      return res.status(400).json({
        success: false,
        message: 'Invalid request body format'
      });
    }
  }
  
  next();
});

// 4. Configure HPP with minimal options
app.use(hpp());

// ======================
// Custom Middleware
// ======================

// 1. Request Logger
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.originalUrl}`, {
    query: req.query,
    body: req.body,
    ip: req.ip
  });
  next();
});

// 2. WebSocket Server in Request
app.use((req: Request, res: Response, next: NextFunction) => {
  req.io = io;
  next();
});

// ======================
// Routes
// ======================

// 1. Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

// 3. API Routes
app.use(`/api/v1/users`, userRouter);
app.use(`/api/v1/polls`, pollRouter);

// Add this to your app.ts before the error handlers
app.get('/ws-test', (req, res) => {
  if (req.io) {
    req.io.emit('test', { message: 'WebSocket is working!' });
    res.json({ status: 'Test message sent' });
  } else {
    res.status(500).json({ error: 'WebSocket not initialized' });
  }
});

// ======================
// Error Handling
// ======================

// 1. 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ 
    success: false,
    message: `Can't find ${req.originalUrl} on this server!`
  });
});

// 2. Global Error Handler
app.use(errorHandler);

// ======================
// Process Event Handlers
// ======================

// 1. Unhandled Rejections
process.on('unhandledRejection', (err: Error) => {
  logger.error('UNHANDLED REJECTION! Shutting down...');
  logger.error(err.name, err.message);
  
  httpServer.close(() => {
    process.exit(1);
  });
});

// 2. Uncaught Exceptions
process.on('uncaughtException', (err: Error) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...');
  logger.error(err.name, err.message);
  process.exit(1);
});

// ======================
// Export Prisma client
// ======================

export { prisma };