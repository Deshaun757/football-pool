declare global {
  namespace Express {
    interface Request {
      userId?: number;
      userRole?: 'player' | 'admin';
    }
  }
}

export {};
