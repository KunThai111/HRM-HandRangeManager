import type { UserRow } from './db.js';

declare global {
  namespace Express {
    interface User extends UserRow {}
  }
}

export {};
