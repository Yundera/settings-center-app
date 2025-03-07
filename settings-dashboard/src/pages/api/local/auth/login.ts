// pages/api/auth/login.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { generateToken } from "@/backend/auth/jwt";
import axios from 'axios';
import {getConfig} from "@/configuration/getConfigBackend";

// [POST] http://8080-casaos-test.localhost/v1/users/login
/**
 * {username: "xxxxx", password: "xxxx"}
 */
/**
 * {
 *     "success": 200,
 *     "message": "ok",
 *     "data": {
 *         "token": {
 *             "refresh_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Indpc2VmZXJyZXQiLCJpZCI6MSwiaXNzIjoicmVmcmVzaCIsImV4cCI6MTczNTE0NDYyMCwibmJmIjoxNzM0NTM5ODIwLCJpYXQiOjE3MzQ1Mzk4MjB9.vQUGayII8dJpVwhVnUNoRofed0AIoiwBpiCFPE1TWJDgrLw8uV8-NEhFzINn9-i1rXZBjNvI0b7KqviL0h-QoA",
 *             "access_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Indpc2VmZXJyZXQiLCJpZCI6MSwiaXNzIjoiY2FzYW9zIiwiZXhwIjoxNzM0NTUwNjIwLCJuYmYiOjE3MzQ1Mzk4MjAsImlhdCI6MTczNDUzOTgyMH0.tW7V2P8pjNBg6P_Bre9QepbSImLxSYq8EDVgmaGQqQirNyXGHQvdmyVfWWLkTgdyJlUqDI6zJM70pGZkn12STw",
 *             "expires_at": 1734550620
 *         },
 *         "user": {
 *             "id": 1,
 *             "username": "xxxx",
 *             "role": "admin",
 *             "email": "",
 *             "nickname": "",
 *             "avatar": "",
 *             "description": "",
 *             "created_at": "2024-12-06T14:03:35.170796391Z",
 *             "updated_at": "0001-01-01T00:00:00Z"
 *         }
 *     }
 * }
 */

interface CasaOSAuthResponse {
  success: number;
  message: string;
  data: {
    token: {
      refresh_token: string;
      access_token: string;
      expires_at: number;
    };
    user: {
      id: number;
      username: string;
      role: string;
      email: string;
      nickname: string;
      avatar: string;
      description: string;
      created_at: string;
      updated_at: string;
    };
  };
}

interface LoginRequest {
  username: string;
  password: string;
}

interface LoginResponse {
  user: {
    id: string;
    fullName: string;
    email: string;
    avatar: string;
    role: string;
  };
  authToken: string;
}

export function getAuthority(host:string):string{
  if(getConfig("AUTHORITY_ENDPOINT")) {
    return getConfig("AUTHORITY_ENDPOINT");
  }
  //return `https://${host.replace('admin-', 'casaos-')}`;//final
  //return `https://${host.replace('admin-', '8080-casaos-')}`;
  return `https://${host.replace('admin-', '')}`;//temp
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body as LoginRequest;

    if (!username || !password) {
      return res.status(400).json({
        message: 'Username and password are required'
      });
    }
    const host = req.headers.host || '';
    const authorityEndpoint = `${getAuthority(host)}/login`;
    if (!authorityEndpoint) {
      throw new Error('Authority endpoint not configured');
    }

    try {
      const casaOSResponse = await axios.post<CasaOSAuthResponse>(
        authorityEndpoint,
        { username, password }
      );

      if (casaOSResponse.data.success !== 200 || casaOSResponse.data.message !== 'ok') {
        throw new Error('Authority authentication failed');
      }

      const { user } = casaOSResponse.data.data;
      let avatarAccessToken = casaOSResponse.data.data.token.access_token;
      const authToken = generateToken(username);

      const response: LoginResponse = {
        user: {
          id: username,
          fullName: user.nickname || username,
          email: user.email,
          avatar: `${getAuthority(host)}/avatar?token=${avatarAccessToken}`,
          role: user.role
        },
        authToken
      };

      return res.status(200).json(response);

    } catch (apiError) {
      console.error('Login error:', apiError);
      if (axios.isAxiosError(apiError)) {
        const status = apiError.response?.status || 500;
        const message = apiError.response?.data?.message || 'Authentication failed';
        return res.status(status).json({ message });
      }
      throw apiError;
    }

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
}