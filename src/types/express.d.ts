import { Socket, Server as SocketIOServer } from 'socket.io';
import { JwtPayload, UserRole } from '../utils/auth';
import * as express from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        email: string;
        name: string;
        role?: UserRole;
      };
      cookies?: {
        token?: string;
        [key: string]: any;
      };
      params: {
        [key: string]: string;
      };
      body: any;
      headers: {
        [key: string]: string | string[] | undefined;
        authorization?: string;
      };
      query: {
        [key: string]: string | string[] | undefined;
      };
      app: Application & {
        get(name: 'io'): SocketIOServer;
      };
    }

    interface Application {
      get(name: string): any;
      set(name: string, value: any): Application;
    }
  }
}

export interface AuthenticatedRequest extends express.Request {
  user: {
    userId: number;
    email: string;
    name: string;
    role?: UserRole;
  };
  app: express.Application & {
    get(name: 'io'): SocketIOServer;
  };
}

export {};
