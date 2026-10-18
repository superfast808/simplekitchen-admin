// Uses the browser's native WebAuthn implementation: no third-party site
// ever receives the credential material or registration challenge.
const decode = (encoded: string): Uint8Array => {
  const input = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - encoded.length % 4) % 4));
  return Uint8Array.from(input, c => c.charCodeAt(0));
};
const encode = (buf: ArrayBuffer): string => {
  const chars = new Uint8Array(buf);
  let binary = "";
  chars.forEach(x => binary += String.fromCharCode(x));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const passkeySupported = () =>
  typeof window !== "undefined" && !!window.PublicKeyCredential &&
  !!navigator.credentials && window.isSecureContext;

async function post(path: string, body: object) {
  const response = await fetch(path, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.message || "Passkey request failed");
  return value;
}

export async function enrolPasskey() {
  if (!passkeySupported()) throw new Error("Passkeys require a supported browser on HTTPS");
  const options = await post("/api/auth/mfa/passkey/register/options", {});
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: decode(options.challenge) as unknown as BufferSource,
    user: { ...options.user, id: decode(options.user.id) as unknown as BufferSource },
    excludeCredentials: (options.excludeCredentials || []).map((c: any) => ({
      ...c, id: decode(c.id) as unknown as BufferSource,
    })),
  };
  const value = await navigator.credentials.create({ publicKey });
  if (!value) throw new Error("Passkey registration was cancelled");
  const credential = value as PublicKeyCredential;
  const response = credential.response as AuthenticatorAttestationResponse;
  return post("/api/auth/mfa/passkey/register/finish", {
    id: credential.id, rawId: encode(credential.rawId), type: "public-key",
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      attestationObject: encode(response.attestationObject),
      clientDataJSON: encode(response.clientDataJSON),
      transports: response.getTransports?.() || [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  });
}

export async function verifyPasskey() {
  if (!passkeySupported()) throw new Error("Passkeys require a supported browser on HTTPS");
  const options = await post("/api/auth/mfa/passkey/options", {});
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: decode(options.challenge) as unknown as BufferSource,
    allowCredentials: (options.allowCredentials || []).map((c: any) => ({
      ...c, id: decode(c.id) as unknown as BufferSource,
    })),
  };
  const value = await navigator.credentials.get({ publicKey });
  if (!value) throw new Error("Passkey verification was cancelled");
  const credential = value as PublicKeyCredential;
  const response = credential.response as AuthenticatorAssertionResponse;
  return post("/api/auth/mfa/passkey/finish", {
    id: credential.id, rawId: encode(credential.rawId), type: "public-key",
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      authenticatorData: encode(response.authenticatorData),
      clientDataJSON: encode(response.clientDataJSON),
      signature: encode(response.signature),
      userHandle: response.userHandle ? encode(response.userHandle) : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  });
}
