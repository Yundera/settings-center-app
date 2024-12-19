// types/auth.ts
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