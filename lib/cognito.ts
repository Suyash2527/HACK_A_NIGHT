// SERVER-ONLY. Amazon Cognito authentication (email + password, USER_PASSWORD_AUTH, public client — no secret).
// Cognito only proves WHO the caller is. Roles, stations and case access always come from our database (by email).
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { unauthenticated } from "./errors";

export interface CognitoConfig { region: string; userPoolId: string; clientId: string }

export function cognitoConfig(env: NodeJS.ProcessEnv = process.env): CognitoConfig | null {
  const userPoolId = env.COGNITO_USER_POOL_ID, clientId = env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) return null;
  return { region: env.AWS_REGION || userPoolId.split("_")[0], userPoolId, clientId };
}

export type Authenticator = (email: string, password: string) => Promise<{ email: string }>;

/** Signs in with Cognito and returns the verified email claim. Throws UNAUTHENTICATED for any failure (no detail leaked). */
export function cognitoAuthenticator(cfg: CognitoConfig): Authenticator {
  const client = new CognitoIdentityProviderClient({ region: cfg.region });
  const verifier = CognitoJwtVerifier.create({ userPoolId: cfg.userPoolId, tokenUse: "id", clientId: cfg.clientId });
  return async (email, password) => {
    try {
      const out = await client.send(new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH", ClientId: cfg.clientId, AuthParameters: { USERNAME: email, PASSWORD: password },
      }));
      const idToken = out.AuthenticationResult?.IdToken;
      if (!idToken) throw new Error("no token");
      const claims = await verifier.verify(idToken); // signature, issuer, audience and expiry checked against the pool's JWKS
      const verifiedEmail = String(claims.email ?? "").toLowerCase();
      if (!verifiedEmail) throw new Error("no email claim");
      return { email: verifiedEmail };
    } catch {
      throw unauthenticated("Invalid email or password");
    }
  };
}
