import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { Server } from 'http';

declare global {
  // eslint-disable-next-line no-var
  var httpServer: Server | undefined;
}

// Extend the Prisma error types
type PrismaClientKnownRequestError = Error & {
  code?: string;
  meta?: {
    target?: string[];
    field_name?: string;
    [key: string]: any;
  };
};

interface AppError extends Error {
  statusCode?: number;
  code?: string | number;
  errors?: Record<string, string[]>;
  isOperational?: boolean;
  meta?: Record<string, any>;
  keyValue?: Record<string, any>;
}

const isProduction = process.env.NODE_ENV === 'production';

// Handle Zod validation errors
const handleZodError = (error: ZodError) => {
  const errors = error.issues.reduce((acc, issue) => {
    const path = issue.path.join('.');
    if (!acc[path]) {
      acc[path] = [];
    }
    acc[path].push(issue.message);
    return acc;
  }, {} as Record<string, string[]>);

  return {
    statusCode: 400,
    success: false,
    message: 'Validation Error',
    error: {
      code: 'VALIDATION_ERROR',
      details: errors,
      timestamp: new Date().toISOString()
    },
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  };
};

// Handle Prisma errors
const handlePrismaError = (error: PrismaClientKnownRequestError) => {
  const errorResponse: {
    success: boolean;
    error: {
      code: string;
      timestamp: string;
      details: Record<string, any>;
      stack?: string;
    };
    statusCode: number;
    message: string;
    errors?: Record<string, string[]>;
  } = {
    success: false,
    error: {
      code: 'DATABASE_ERROR',
      timestamp: new Date().toISOString(),
      details: {},
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    },
    statusCode: 500,
    message: 'Database error occurred'
  };

  switch (error.code) {
    case 'P2002': {
      // Handle duplicate field errors
      const targetField = error.meta?.target?.[0] || 'field';
      errorResponse.error.code = 'DUPLICATE_ENTRY';
      errorResponse.statusCode = 409;
      errorResponse.message = 'Duplicate field value';
      errorResponse.errors = {
        [targetField]: ['This value is already in use']
      };
      if (error.stack) {
        console.error('Error Stack:', error.stack);
      }
      return errorResponse;
    }
    case 'P2025':
      return {
        statusCode: 404,
        message: 'Resource not found',
      };
    case 'P2003':
      return {
        statusCode: 400,
        message: 'Invalid reference',
        errors: {
          [error.meta?.field_name as string]: ['Invalid reference'],
        },
      };
    default:
      return {
        statusCode: 400,
        message: 'Database error',
      };
  }
};

// Handle JWT errors
const handleJWTError = () => ({
  statusCode: 401,
  message: 'Invalid token. Please log in again!',
});

const handleJWTExpiredError = () => ({
  statusCode: 401,
  message: 'Your token has expired! Please log in again.',
});

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  // Default error response
  const errorResponse: {
    success: boolean;
    message: string;
    error: {
      code: string | number | undefined;
      timestamp: string;
      details?: Record<string, any>;
      stack?: string;
    };
    errors?: Record<string, string[]>;
  } = {
    success: false,
    message: err.message || 'An unexpected error occurred',
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString(),
    }
  };

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = err.stack;
  }

  // Handle specific error types
  if (err instanceof ZodError) {
    const validationError = handleZodError(err);
    return res.status(validationError.statusCode || 400).json(validationError);
  }

  // Handle Prisma errors
  if (err.code && typeof err.code === 'string' && (err.code.startsWith('P2') || err.code.startsWith('P1'))) {
    const prismaError = handlePrismaError(err as PrismaClientKnownRequestError);
    return res.status(prismaError.statusCode || 500).json(prismaError);
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    const jwtError = handleJWTError();
    return res.status(jwtError.statusCode || 401).json({
      success: false,
      message: 'Invalid token',
      error: {
        code: 'INVALID_TOKEN',
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      }
    });
  }

  // Handle token expired error
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token has expired',
      error: {
        code: 'TOKEN_EXPIRED',
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      }
    });
  }

  // Handle operational errors
  if (err.isOperational) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
      error: {
        code: err.code || 'OPERATIONAL_ERROR',
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      }
    });
  }

  // Handle validation errors
  if (err.errors) {
    errorResponse.errors = err.errors as Record<string, string[]>;
  }

  // Log unexpected errors in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Unexpected Error:', err);
  }

  // In production, ensure we don't expose internal errors
  if (process.env.NODE_ENV === 'production') {
    if (!err.isOperational) {
      errorResponse.message = 'Something went wrong!';
    }
    // Remove stack trace in production
    delete errorResponse.error.stack;
  }

  // Send final error response
  res.status(errorResponse.error.code === 'VALIDATION_ERROR' ? 400 : 500).json(errorResponse);
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: Error | any) => {
  console.error('\n--- UNHANDLED REJECTION ---');
  console.error('Time:', new Date().toISOString());
  console.error('Reason:', reason?.message || reason);
  
  if (reason instanceof Error) {
    console.error('Stack:', reason.stack);
  }
  
  // For development, log the error but don't crash
  if (process.env.NODE_ENV === 'development') {
    console.error('\n[DEV] Process will continue running in development mode.\n');
    return;
  }
  
  // In production, attempt a graceful shutdown
  console.error('\nInitiating graceful shutdown...');
  
  // If we have access to the HTTP server, close it first
  if (globalThis.httpServer) {
    globalThis.httpServer.close(() => {
      console.log('HTTP server closed');
      process.exit(1);
    });
    
    // Force exit after timeout
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
  console.error('\n--- UNCAUGHT EXCEPTION ---');
  console.error('Time:', new Date().toISOString());
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  
  // For development, log the error but don't crash
  if (process.env.NODE_ENV === 'development') {
    console.error('\n[DEV] Process will continue running in development mode.\n');
    return;
  }
  
  // In production, attempt a graceful shutdown
  console.error('\nInitiating graceful shutdown...');
  
  // If we have access to the HTTP server, close it first
  if (globalThis.httpServer) {
    globalThis.httpServer.close(() => {
      console.log('HTTP server closed');
      process.exit(1);
    });
    
    // Force exit after timeout
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(1);
  }
});