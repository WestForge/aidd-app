import type { GitProvider } from './gitSyncTypes';

export interface GitCredentialStore {
  saveToken(projectPath: string, provider: GitProvider, token: string): Promise<void>;
  getToken(projectPath: string, provider: GitProvider): Promise<string | null>;
  clearToken(projectPath: string, provider: GitProvider): Promise<void>;
  hasToken(projectPath: string, provider: GitProvider): Promise<boolean>;
}

const SERVICE = 'aidd-git-sync';

function account(projectPath: string, provider: GitProvider) {
  return `${Buffer.from(projectPath).toString('base64url')}:${provider}`;
}

async function loadKeytar() {
  try {
    return await import('keytar');
  } catch {
    throw new Error('Secure credential storage is unavailable. The access token was not saved.');
  }
}

export function createKeytarCredentialStore(): GitCredentialStore {
  const store: GitCredentialStore = {
    async saveToken(projectPath, provider, token) {
      if (!token?.trim()) return;
      const keytar = await loadKeytar();
      await keytar.setPassword(SERVICE, account(projectPath, provider), token.trim());
    },
    async getToken(projectPath, provider) {
      const keytar = await loadKeytar();
      return keytar.getPassword(SERVICE, account(projectPath, provider));
    },
    async clearToken(projectPath, provider) {
      const keytar = await loadKeytar();
      await keytar.deletePassword(SERVICE, account(projectPath, provider));
    },
    async hasToken(projectPath, provider) {
      const token = await store.getToken(projectPath, provider);
      return Boolean(token);
    }
  };
  return store;
}

export function createMemoryCredentialStore(): GitCredentialStore {
  const tokens = new Map<string, string>();
  return {
    async saveToken(projectPath, provider, token) {
      if (token?.trim()) tokens.set(account(projectPath, provider), token.trim());
    },
    async getToken(projectPath, provider) {
      return tokens.get(account(projectPath, provider)) ?? null;
    },
    async clearToken(projectPath, provider) {
      tokens.delete(account(projectPath, provider));
    },
    async hasToken(projectPath, provider) {
      return tokens.has(account(projectPath, provider));
    }
  };
}
