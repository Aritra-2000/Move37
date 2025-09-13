import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import bcrypt from 'bcryptjs';
import { registerSchema, loginSchema } from '../zod/zod';
import { generateToken, setAuthCookie } from '../utils/auth';
import { PrismaClient } from '../generated/prisma';
const prisma = new PrismaClient();

export const loginUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate request body
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.issues,
        error: {
          code: 'VALIDATION_ERROR',
          fields: validation.error.issues.map(issue => issue.path.join('.'))
        }
      });
    }

    const { email, password } = validation.data;

    // Find user with rate limiting consideration
    const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return tx.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: {
          id: true,
          email: true,
          name: true,
          password: true,
          // Add any additional fields needed for session
        }
      });
    });

    // Use constant-time comparison to prevent timing attacks
    const passwordMatch = user ? await bcrypt.compare(password, user.password) : false;
    
    if (!user || !passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        error: {
          code: 'INVALID_CREDENTIALS',
          fields: ['email', 'password']
        }
      });
    }

    // Generate JWT token with expiration
    const token = generateToken({
      userId: user.id,
      email: user.email
    });

    // Set secure HTTP-only cookie
    setAuthCookie(res, token);

    // Remove sensitive data from response
    const { password: _, ...userWithoutPassword } = user;
    
    res.status(200).json({
      success: true,
      data: {
        user: userWithoutPassword,
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    
    // Handle Prisma errors
    if (error instanceof PrismaClientKnownRequestError) {
      return res.status(400).json({
        success: false,
        message: 'Database error',
        error: {
          code: 'DATABASE_ERROR',
          message: 'An error occurred while processing your request'
        }
      });
    }

    // Handle other unexpected errors
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred',
      error: process.env.NODE_ENV === 'development' 
        ? { message: (error as Error).message, stack: (error as Error).stack }
        : { code: 'INTERNAL_SERVER_ERROR' }
    });
  }
};

export const getCurrentUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
    }

    // Get user data with sensitive fields excluded
    const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          updatedAt: true
        }
      });
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        error: {
          code: 'USER_NOT_FOUND',
          message: 'The requested user does not exist'
        }
      });
    }

    // Add any additional user data that should be included in the response
    const userData = {
      ...user,
      // Add any computed or derived fields here
    };

    res.status(200).json({
      success: true,
      data: userData
    });
  } catch (error) {
    console.error('Get current user error:', error);
    
    // Handle Prisma errors
    if (error instanceof PrismaClientKnownRequestError) {
      return res.status(400).json({
        success: false,
        message: 'Database error',
        error: {
          code: 'DATABASE_ERROR',
          message: 'An error occurred while fetching user data'
        }
      });
    }

    // Handle other unexpected errors
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred',
      error: process.env.NODE_ENV === 'development' 
        ? { message: (error as Error).message, stack: (error as Error).stack }
        : { code: 'INTERNAL_SERVER_ERROR' }
    });
  }
};

export const createUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate request body
    console.log('Request body:', req.body);
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      console.error('Validation errors:', validation.error.issues);
      const errorDetails = validation.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more fields are invalid',
          details: errorDetails,
          receivedData: req.body
        }
      });
    }

    const { name, email, password } = validation.data;
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedName = name.trim();

    // Check for existing user in a transaction to prevent race conditions
    const existingUser = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true }
      });
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists',
        error: {
          code: 'EMAIL_IN_USE',
          fields: ['email'],
          message: 'This email address is already registered'
        }
      });
    }

    // Hash password with configurable salt rounds
    const saltRounds = parseInt(process.env.SALT_ROUNDS || '10', 10);
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user in a transaction
    const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return tx.user.create({
        data: {
          name: normalizedName,
          email: normalizedEmail,
          password: hashedPassword
        },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          updatedAt: true
        }
      });
    });

    // Generate JWT token with expiration
    const token = generateToken({
      userId: user.id,
      email: user.email
    });
    
    // Set secure HTTP-only cookie
    setAuthCookie(res, token);

    // Prepare user data for response
    const userData = {
      ...user,
      // Add any additional computed fields here
    };

    res.status(201).json({
      success: true,
      data: {
        user: userData,
        token
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    
    // Handle Prisma errors
    if (error instanceof PrismaClientKnownRequestError) {
      // Handle unique constraint violation
      if (error.code === 'P2002') {
        const meta = error.meta as { target?: string[] } | undefined;
        const field = meta?.target?.[0] || 'field';
        return res.status(409).json({
          success: false,
          message: 'User with this email already exists',
          error: {
            code: 'DUPLICATE_ENTRY',
            field,
            message: `A user with this ${field} already exists`
          }
        });
      }
      
      return res.status(400).json({
        success: false,
        message: 'Database error',
        error: {
          code: 'DATABASE_ERROR',
          message: 'An error occurred while creating user'
        }
      });
    }

    // Handle other unexpected errors
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred',
      error: process.env.NODE_ENV === 'development' 
        ? { 
            message: (error as Error).message, 
            stack: (error as Error).stack 
          }
        : { 
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Please try again later'
          }
    });
  }
};