declare global {
  namespace Express {
    interface Request {
      user?: { id: string; username: string };
      requestId: string;
    }
  }
}

export {};
