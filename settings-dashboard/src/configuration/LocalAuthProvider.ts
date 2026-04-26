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

function redirectToOIDCLogin(): Promise<never> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Not authenticated"));
  }
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/api/auth/oidc/login?returnTo=${returnTo}`);
  return new Promise<never>(() => {}); // navigation in progress
}

export const localAuthProvider : ( AuthProvider & AuthProviderAPIAccess)= {
  async listPermissions() {
    return {};
  },
  async login() {
    return redirectToOIDCLogin();
  },
  async checkError(error) {
    const status = error.status;
    if (status === 401 || status === 403) {
      localStorage.removeItem('user');
      return redirectToOIDCLogin();
    }
    // other error codes (404, 500, etc): no need to log out
  },
  async checkAuth() {
    if (!localStorage.getItem('user')) {
      return redirectToOIDCLogin();
    }
    const token = await this.getIdToken();
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const response = await axios.post('/api/local/auth/check-auth', {}, {
      headers: headers
    });
    if (response.status !== 200) {
      localStorage.removeItem('user');
      return redirectToOIDCLogin();
    }
  },
  async logout() {
    localStorage.removeItem('user');
    if (typeof window !== "undefined") {
      window.location.replace('/api/auth/oidc/logout');
      return new Promise<never>(() => {});
    }
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
