import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

const IDENTITY_FILE = 'git-identity.json';

export interface AiddGitIdentity {
  authorName: string;
  authorEmail: string;
  source: 'saved' | 'git-global' | 'none';
}

export interface AiddSaveGitIdentityInput {
  authorName: string;
  authorEmail: string;
}

function identityPath(userDataPath: string) {
  return path.join(userDataPath, IDENTITY_FILE);
}

function cleanIdentity(input: Partial<AiddSaveGitIdentityInput>): AiddSaveGitIdentityInput {
  return {
    authorName: input.authorName?.trim() || '',
    authorEmail: input.authorEmail?.trim() || '',
  };
}

function assertValidIdentity(identity: AiddSaveGitIdentityInput) {
  if (!identity.authorName.trim()) {
    throw new Error('Author name is required.');
  }

  if (!identity.authorEmail.trim()) {
    throw new Error('Author email is required.');
  }

  if (!identity.authorEmail.includes('@')) {
    throw new Error('Author email must be a valid email address.');
  }
}

export async function readSavedGitIdentity(userDataPath: string): Promise<AiddGitIdentity | null> {
  try {
    const raw = await fsp.readFile(identityPath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AiddSaveGitIdentityInput>;
    const clean = cleanIdentity(parsed);

    if (!clean.authorName || !clean.authorEmail) {
      return null;
    }

    return {
      ...clean,
      source: 'saved',
    };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function parseGitConfigUser(raw: string): AiddSaveGitIdentityInput | null {
  let inUserSection = false;
  let authorName = '';
  let authorEmail = '';

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      inUserSection = sectionMatch[1].trim().toLowerCase() === 'user';
      continue;
    }

    if (!inUserSection) {
      continue;
    }

    const keyValueMatch = line.match(/^([^=]+)=(.*)$/);
    if (!keyValueMatch) {
      continue;
    }

    const key = keyValueMatch[1].trim().toLowerCase();
    const value = keyValueMatch[2].trim().replace(/^"(.*)"$/, '$1');

    if (key === 'name') {
      authorName = value;
    }

    if (key === 'email') {
      authorEmail = value;
    }
  }

  if (!authorName || !authorEmail) {
    return null;
  }

  return { authorName, authorEmail };
}

export async function readGlobalGitIdentity(): Promise<AiddGitIdentity | null> {
  const candidatePaths = [
    path.join(os.homedir(), '.gitconfig'),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.gitconfig') : '',
  ].filter(Boolean);

  for (const filePath of candidatePaths) {
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = parseGitConfigUser(raw);

      if (parsed) {
        return {
          ...parsed,
          source: 'git-global',
        };
      }
    } catch {
      // Ignore unreadable global Git config files and try the next candidate.
    }
  }

  return null;
}

export async function readGitIdentity(userDataPath: string): Promise<AiddGitIdentity | null> {
  return (await readSavedGitIdentity(userDataPath)) ?? (await readGlobalGitIdentity());
}

export async function requireGitIdentity(userDataPath: string, override?: Partial<AiddSaveGitIdentityInput>): Promise<AiddSaveGitIdentityInput> {
  const cleanOverride = cleanIdentity(override || {});

  if (cleanOverride.authorName && cleanOverride.authorEmail) {
    assertValidIdentity(cleanOverride);
    await saveGitIdentity(userDataPath, cleanOverride);
    return cleanOverride;
  }

  const existing = await readGitIdentity(userDataPath);

  if (!existing) {
    throw new Error('AIDD author identity is required before local Git can be configured.');
  }

  const cleanExisting = cleanIdentity(existing);
  assertValidIdentity(cleanExisting);
  return cleanExisting;
}

export async function saveGitIdentity(userDataPath: string, input: AiddSaveGitIdentityInput): Promise<AiddGitIdentity> {
  const clean = cleanIdentity(input);
  assertValidIdentity(clean);

  await fsp.mkdir(userDataPath, { recursive: true });
  await fsp.writeFile(identityPath(userDataPath), `${JSON.stringify(clean, null, 2)}\n`, 'utf8');

  return {
    ...clean,
    source: 'saved',
  };
}
