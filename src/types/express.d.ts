declare global {
  namespace Express {
    interface Request {
      userId?: number;
      userRole?: 'player' | 'admin';
      sessionTokenHash?: Buffer;
      groupId?: number;
      groupRole?: 'member' | 'commissioner';
    }
  }
}

export {};
