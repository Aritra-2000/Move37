import { Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';
import { setupWebSocket } from './server';

let io: ReturnType<typeof setupWebSocket>;

export const initWebSocket = (server: HttpServer | HttpsServer) => {
  io = setupWebSocket(server);
  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

export * from './server';
