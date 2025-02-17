import {AuthProvider} from "ra-core";
import axios from "axios";
import {AuthProviderAPIAccess} from "dashboard-core/interface/AuthProviderAPIAccess";

interface LocalUser{
  user: {
    id: string
    fullName: string
    email: string
    avatar: string
    role: string
  },
  authToken: string
}

export const localAuthProvider : ( AuthProvider & AuthProviderAPIAccess)= {
  async listPermissions() {
    console.log('listPermissions');
    return {};
  },
  async login({ username, password }) {
    try {
      const response = await axios.post('/api/local/auth/login', {
        username,
        password
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      const data : LocalUser = response.data;
      localStorage.setItem('user', JSON.stringify(data));
    } catch (error) {
      throw new Error('Login failed');
    }
  },
  async checkError(error) {
    const status = error.status;
    if (status === 401 || status === 403) {
      localStorage.removeItem('user');
      throw new Error('Session expired');
    }
    // other error codes (404, 500, etc): no need to log out
  },
  async checkAuth() {
    if (!localStorage.getItem('user')) {
      throw new Error('Not authenticated');
    }
    // Prepare headers
    const token = await this.getIdToken();
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const response = await axios.post('/api/local/auth/check-auth', {}, {
      headers: headers
    });
    if(response.status !== 200){
      localStorage.removeItem('user');//force user to login again
      throw new Error('Not authenticated');
    }
  },
  async logout() {
    localStorage.removeItem('user');
  },
  async getIdentity() {
    const user = JSON.parse(localStorage.getItem('user') || '{user:{}}') as LocalUser;
    return {
      id: user.user.id,
      fullName: user.user.fullName,
      avatar: user.user.avatar,
      email: user.user.email,
      role: user.user.role,
      authToken: user.authToken
    };
  },
  async getIdToken(): Promise<string> {
    const user = JSON.parse(localStorage.getItem('user') || '{user:{}}') as LocalUser;
    return user.authToken;
  }
};