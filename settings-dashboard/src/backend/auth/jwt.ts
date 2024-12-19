// utils/jwt.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {getConfig} from "@/configuration/getConfigBackend";

// Generate a random string of 64 bytes (512 bits) and convert to base64
const generateRandomSecret = (): string => {
  return crypto.randomBytes(64).toString('base64');
};

// Use environment variable if available, otherwise generate a random secret
// The secret will remain constant during the application lifecycle
const JWT_SECRET = getConfig("JWT_SECRET") || generateRandomSecret();

export const generateToken = (userId: string): string => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1d' });
};

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};