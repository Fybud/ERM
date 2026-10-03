import { Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

export class AuthController {
  login = async (req: Request, res: Response) => {
    const password = String(req.body?.password || "").trim();
    if (!env.adminPassword) {
      throw new AppError("No admin password configured", 500);
    }
    if (password !== env.adminPassword) {
      throw new AppError("Invalid password", 401);
    }
    return res.json({ success: true });
  };

  logout = async (_req: Request, res: Response) => {
    return res.json({ success: true });
  };
}

export const authController = new AuthController();
