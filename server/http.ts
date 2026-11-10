import type { Response } from 'express';

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}
