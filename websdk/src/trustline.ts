import {
  TrustlineInitOptions,
  JsonRpcErrorResponse,
  JWTAuthMessage,
  OpenSessionSolanaParams,
  OpenSessionSolanaResult,
  SolanaValidateParams,
  ValidateSolanaParams,
  ValidateSolanaResult
} from './types';
import { buildInstructionPayload, isTransactionInstructionLike } from './solana';

const DEFAULT_API_URL = 'https://api.trustline.id/api/v0';
const AUTH_URL = 'https://auth.trustline.id';

class TrustlineSDK {
  private clientId: string | null = null;
  private apiUrl: string = DEFAULT_API_URL;
  private loginUri?: string;

  init(options: TrustlineInitOptions) {
    this.clientId = options.clientId;
    this.apiUrl = options.apiUrl ?? DEFAULT_API_URL;
    this.loginUri = options.loginUri;
    if (!this.clientId) {
      throw new Error('Trustline: clientId is required');
    }
  }

  private ensureInitialized() {
    if (!this.clientId) {
      throw new Error('Trustline: SDK not initialized');
    }
  }

  private async postJsonRpc<T>(
    method: string,
    params: Record<string, unknown>,
    jwt?: string
  ): Promise<T> {
    this.ensureInitialized();

    const body = {
      jsonrpc: '2.0',
      method,
      params,
      id: 1,
    };

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
    });

    return (await response.json()) as T;
  }

  private ensureNoRpcError(response: { error?: JsonRpcErrorResponse['error'] }) {
    if (response.error) {
      throw new Error(`Trustline: RPC error ${response.error.code}: ${response.error.message}`);
    }
  }

  private isJsonRpcError(response: unknown): response is JsonRpcErrorResponse {
    if (!response || typeof response !== 'object') {
      return false;
    }
    return 'error' in response;
  }

  private validateOpenSessionParams(params: OpenSessionSolanaParams) {
    if (!params.chainId) throw new Error('Trustline: chainId is required');
    if (!params.subject) throw new Error('Trustline: subject is required');
    if (!params.scope) throw new Error('Trustline: scope is required');
    if (!params.protectedProgram) throw new Error('Trustline: protectedProgram is required');
    const instruction = isTransactionInstructionLike(params.instruction)
      ? buildInstructionPayload(params.instruction)
      : params.instruction;

    if (!instruction?.data) throw new Error('Trustline: instruction.data is required');
    if (!Array.isArray(instruction?.accounts)) {
      throw new Error('Trustline: instruction.accounts must be an array');
    }
    for (const [index, account] of instruction.accounts.entries()) {
      if (!account.pubkey) throw new Error(`Trustline: instruction.accounts[${index}].pubkey is required`);
      if (typeof account.isSigner !== 'boolean') {
        throw new Error(`Trustline: instruction.accounts[${index}].isSigner must be boolean`);
      }
      if (typeof account.isWritable !== 'boolean') {
        throw new Error(`Trustline: instruction.accounts[${index}].isWritable must be boolean`);
      }
    }
  }

  private normalizeInstruction(params: OpenSessionSolanaParams) {
    if (isTransactionInstructionLike(params.instruction)) {
      return buildInstructionPayload(params.instruction);
    }
    return params.instruction;
  }

  private async openAuthPopup(sessionId?: string, usePopup: boolean = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const qp = new URLSearchParams();
      if (sessionId) {
        qp.set('sessionId', sessionId);
      }
      if (this.loginUri) {
        qp.set('loginUri', this.loginUri);
      }
      const authUrl = `${AUTH_URL}${qp.toString() ? `?${qp.toString()}` : ''}`;

      let cleanup: () => void;
      let checkClosed: ReturnType<typeof setInterval> | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      // Cleanup function
      const cleanupResources = () => {
        if (checkClosed) {
          clearInterval(checkClosed);
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        checkClosed = null;
        timeoutId = null;
        window.removeEventListener('message', messageHandler);
      };

      // Message handler for both popup and iframe
      const messageHandler = (event: MessageEvent) => {
        // Verify the origin for security
        if (event.origin !== AUTH_URL) {
          return;
        }

        try {
          const data = event.data as JWTAuthMessage;
          if (data && data.type === 'JWT_TOKEN' && typeof data.jwt === 'string') {
            // Clean up resources
            cleanupResources();

            // Close popup or remove overlay
            if (cleanup) {
              cleanup();
            }

            // Resolve with the JWT token
            resolve(data.jwt);
          }
        } catch (error) {
          // Invalid message format, ignore
        }
      };

      window.addEventListener('message', messageHandler);

      // Timeout handler
      const handleTimeout = () => {
        cleanupResources();
        if (cleanup) {
          cleanup();
        }
        reject(new Error('Trustline: Authentication timeout'));
      };

      if (usePopup) {
        // Popup mode
        const popupConfig = 'toolbar=no,scrollbars=no,location=no,statusbar=no,menubar=no,resizable=0,width=620,height=800';
        const popup = window.open(authUrl, 'Trustline Authentication', popupConfig);

        if (!popup) {
          window.removeEventListener('message', messageHandler);
          reject(new Error('Trustline: Failed to open authentication popup. Please allow popups for this site.'));
          return;
        }

        popup.focus();

        // Cleanup function for popup
        cleanup = () => {
          if (popup && !popup.closed) {
            popup.close();
          }
        };

        // Popup closed manually
        checkClosed = setInterval(() => {
          if (popup.closed) {
            cleanupResources();
            cleanup();
            reject(new Error('Trustline: Authentication popup was closed by user'));
          }
        }, 1000);

        // Timeout for the authentication process
        timeoutId = setTimeout(handleTimeout, 300000);
      } else {
        // Iframe overlay mode
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.75);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
        `;

        // Iframe container
        const iframeContainer = document.createElement('div');
        iframeContainer.style.cssText = `
          position: relative;
          width: 620px;
          height: 800px;
          max-width: 90vw;
          max-height: 90vh;
          background-color: white;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8);
        `;

        // Close button
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '×';
        closeButton.style.cssText = `
          position: absolute;
          top: 0px;
          right: 0px;
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 5px;
          margin: 10px;
          padding: 0 0;
          background-color:rgba(0, 123, 255, 0.5);
          color: white;
          font-size: 24px;
          font-weight: bold;
          font-family: 'Montserrat', sans-serif;
          cursor: pointer;
          z-index: 1000000;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          transition: background-color 0.2s;
        `;
        closeButton.onmouseover = () => {
          closeButton.style.backgroundColor = 'rgba(0, 123, 255, 1)';
        };
        closeButton.onmouseout = () => {
          closeButton.style.backgroundColor = 'rgba(0, 123, 255, 0.4)';
        };
        closeButton.onclick = () => {
          cleanupResources();
          cleanup();
          reject(new Error('Trustline: Authentication was cancelled by user'));
        };

        // Iframe
        const iframe = document.createElement('iframe');
        iframe.src = authUrl;
        iframe.style.cssText = `
          width: 100%;
          height: 100%;
          border: none;
        `;
        iframe.setAttribute('allow', 'camera; microphone; geolocation');

        iframeContainer.appendChild(closeButton);
        iframeContainer.appendChild(iframe);
        overlay.appendChild(iframeContainer);
        document.body.appendChild(overlay);

        // Prevent body scroll when overlay is open
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        // Cleanup function for iframe overlay
        cleanup = () => {
          if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
          document.body.style.overflow = originalOverflow;
        };

        // Set a timeout for the authentication process
        timeoutId = setTimeout(handleTimeout, 300000);
      }
    });
  }

  async openSessionSolana(params: OpenSessionSolanaParams): Promise<OpenSessionSolanaResult> {
    this.validateOpenSessionParams(params);

    const response = await this.postJsonRpc<OpenSessionSolanaResult>('openSessionSolana', {
      clientId: this.clientId,
      chainId: String(params.chainId),
      subject: params.subject,
      scope: params.scope,
      protectedProgram: params.protectedProgram,
      instruction: this.normalizeInstruction(params),
      validationMode: params.validationMode ?? null,
      approvalRequired: params.approvalRequired ?? false,
    });
    if (this.isJsonRpcError(response)) {
      this.ensureNoRpcError(response);
    }
    return response;
  }

  async validateSolana(params: ValidateSolanaParams, jwt?: string): Promise<ValidateSolanaResult> {
    if (!params.sessionId) {
      throw new Error('Trustline: sessionId is required');
    }

    const response = await this.postJsonRpc<ValidateSolanaResult>('validateSolana', {
      sessionId: params.sessionId,
    }, jwt);
    if (this.isJsonRpcError(response)) {
      this.ensureNoRpcError(response);
    }
    return response;
  }

  async validate(params: SolanaValidateParams, jwt?: string): Promise<ValidateSolanaResult> {
    const openResult = await this.openSessionSolana(params);
    if (this.isJsonRpcError(openResult)) {
      this.ensureNoRpcError(openResult);
      throw new Error('Trustline: unexpected RPC error shape');
    }

    const sessionId = openResult.result.sessionId;
    if (!sessionId) {
      throw new Error('Trustline: openSessionSolana missing sessionId');
    }
    let jwtToken = jwt ?? params.jwt;
    const authRequired = Boolean(openResult.result.authRequired);
    if (!jwtToken && authRequired) {
      jwtToken = await this.openAuthPopup(sessionId);
    }
    return this.validateSolana({ sessionId }, jwtToken);
  }
}

export const trustline = new TrustlineSDK();

// UMD global export for browser usage
if (typeof window !== 'undefined') {
  (window as any).trustline = trustline;
}
