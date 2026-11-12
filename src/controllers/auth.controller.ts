import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../config/prisma.js";
import { registerSchema, loginSchema } from "../schemas/auth.schema.js";
import { Prisma } from "../generated/prisma/client.js";

import jwt from "jsonwebtoken";
import { loginSchema } from "../schemas/auth.schema.js";


export const registerUser = async (req: Request, res: Response) => {
  try {
    // 1. Validate incoming data
    const result = registerSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues,
      });
    }

    // 2. Extract validated data
    const { username, email, password, displayName } = result.data;

    // 3. Hash the password
    const passwordHash = await bcrypt.hash(password, 12);

    // 4. Create the user in PostgreSQL
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        displayName,
      },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        createdAt: true,
      },
    });

    // 5. Return successful response
    return res.status(201).json({
      message: "Account created successfully",
      user,
    });
  } catch (error) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return res.status(409).json({
      message: "Username or email already exists",
    });
  }

  console.error("Registration error:", error);

  return res.status(500).json({
    message: "Internal server error",
  });
}
};


export const loginUser = async (req: Request, res: Response) => {
  try {
    // 1. Validate incoming data
    const result = loginSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues,
      });
    }

    // 2. Extract validated data
    const { email, password } = result.data;

    // 3. Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // 4. Compare submitted password with stored hash
    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // 5. Check JWT secret
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured");
    }

    // 6. Generate JWT
    const token = jwt.sign(
      { userId: user.id },
      jwtSecret,
      { expiresIn: "1d" }
    );

    // 7. Return successful response
    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};



export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      message: "User profile retrieved successfully",
      user,
    });
  } catch (error) {
    console.error("Get current user error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};