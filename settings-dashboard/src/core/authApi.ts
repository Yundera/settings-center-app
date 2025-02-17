import {localAuthProvider} from "@/configuration/LocalAuthProvider";

export async function apiRequest<T>(url: string, method: string = "GET", body?: any): Promise<T> {
  try {
    // Get authentication provider
    let authProvider = localAuthProvider;
    let token = await authProvider.getIdToken();

    // Prepare headers
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    // Configure request options
    const options: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    // Make the API call
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    // Parse and return JSON response
    return response.json();
  } catch (error: any) {
    throw new Error(error.message || "Unknown API error");
  }
}
