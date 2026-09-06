declare global {
  namespace Express {
    interface Request {
      userId?: number;
      userRole?: 'player' | 'admin';
      groupId?: number;
      groupRole?: 'member' | 'commissioner';
    }
  }
}

export {};
