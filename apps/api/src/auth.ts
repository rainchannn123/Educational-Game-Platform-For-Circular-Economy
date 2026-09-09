import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Env } from "./env.js";

export interface Principal {
  userId: string;
  roles: string[];
}
declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
export const signToken = (principal: Principal, env: Env): string =>
  jwt.sign({ sub: principal.userId, roles: principal.roles }, env.JWT_SECRET, {
    expiresIn: "8h",
  });
export const requireAuth =
  (env: Env) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const value = request.header("authorization");
    if (!value?.startsWith("Bearer ")) {
      response
        .status(401)
        .json({
          success: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Sign in is required.",
            retryable: false,
          },
        });
      return;
    }
    try {
      const payload = jwt.verify(
        value.slice(7),
        env.JWT_SECRET,
      ) as jwt.JwtPayload;
      request.principal = {
        userId: String(payload.sub),
        roles: Array.isArray(payload.roles) ? payload.roles.map(String) : [],
      };
      next();
    } catch {
      response
        .status(401)
        .json({
          success: false,
          error: {
            code: "INVALID_TOKEN",
            message: "Your session has expired.",
            retryable: false,
          },
        });
    }
  };
export const requirePrivilege =
  (...roles: string[]) =>
  (request: Request, response: Response, next: NextFunction): void =>
    request.principal?.roles.some((role) => roles.includes(role))
      ? next()
      : void response
          .status(403)
          .json({
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "This control requires facilitator access.",
              retryable: false,
            },
          });
