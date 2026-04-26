export interface OIDCClient {
  client_id: string;
  client_secret: string;
  issuer_url: string;
}

export interface OIDCDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  userinfo_endpoint?: string;
}

export interface OIDCStateClaim {
  state: string;
  codeVerifier: string;
  returnTo: string;
  redirectUri: string;
}
