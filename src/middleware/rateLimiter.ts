import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';

// Rate limiting options
const rateLimiterOptions = {
  points: 100, // 100 requests
  duration: 60, // per 60 seconds by IP
};

// Create rate limiter instance
const rateLimiter = new RateLimiterMemory(rateLimiterOptions);

// Rate limiter middleware
export const rateLimiterMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Get client IP
  const clientIp = req.ip || req.connection.remoteAddress || '';
  
  // Skip rate limiting for localhost in development
  if (process.env.NODE_ENV === 'development' && (clientIp === '::1' || clientIp === '127.0.0.1')) {
    return next();
  }

  // Use IP as the key for rate limiting
  const key = clientIp;
  
  // Consume 1 point per request
  rateLimiter.consume(key, 1)
    .then(() => {
      next();
    })
    .catch(() => {
      res.status(429).json({
        status: 'error',
        message: 'Too many requests, please try again later',
      });
    });
};

// Specific rate limiter for authentication endpoints
export const authRateLimiter = new RateLimiterMemory({
  points: 5, // 5 login attempts
  duration: 60 * 60, // per 1 hour by IP
});

export const authRateLimiterMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.ip || req.connection.remoteAddress || '';
  const key = `auth_${clientIp}`;
  
  authRateLimiter.consume(key, 1)
    .then(() => {
      next();
    })
    .catch(() => {
      res.status(429).json({
        status: 'error',
        message: 'Too many login attempts, please try again later',
      });
    });
};
