import matter from '../../frontmatter';
import git from 'isomorphic-git';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AIDD_DEFAULT_BRANCH, TEMPLATE_VERSION, exists, readJson, slugify, writeJson } from './projectCore';
import type { DecisionInput, SourceCodeProject } from './types';

export function detectSourceType(entries: string[]) {
  const names = new Set(entries.map((item) => item.toLowerCase()));
  const indicators: string[] = [];
  let detectedType = 'Unknown / mixed source project';
  if (names.has('package.json')) { indicators.push('package.json'); detectedType = 'JavaScript / TypeScript'; }
  if (names.has('vite.config.ts') || names.has('vite.config.js')) indicators.push('Vite');
  if (names.has('pom.xml')) { indicators.push('pom.xml'); detectedType = 'Java / Maven'; }
  if (names.has('build.gradle') || names.has('build.gradle.kts')) { indicators.push('Gradle'); detectedType = 'Java / JVM'; }
  if (entries.some((item) => item.toLowerCase().endsWith('.sln') || item.toLowerCase().endsWith('.csproj'))) { indicators.push('.sln/.csproj'); detectedType = 'C# / .NET'; }
  if (entries.some((item) => item.toLowerCase().endsWith('.uproject'))) { indicators.push('.uproject'); detectedType = 'Unreal Engine'; }
  if (names.has('pyproject.toml') || names.has('setup.py')) { indicators.push('pyproject/setup.py'); detectedType = 'Python'; }
  if (names.has('cargo.toml')) { indicators.push('Cargo.toml'); detectedType = 'Rust'; }
  return { detectedType, indicators };
}

export async function readSourceProjects(projectPath: string): Promise<SourceCodeProject[]> {
  const projectsDir = path.join(projectPath, 'source-code', 'projects');
  if (!(await exists(projectsDir))) {
    const legacy = await readSourceReference(projectPath);
    return legacy ? [{
      id: slugify(path.basename(legacy.path) || 'source-project'),
      name: path.basename(legacy.path) || 'Source Project',
      path: legacy.path,
      detectedType: legacy.detectedType,
      indicators: legacy.indicators || [],
      createdAt: legacy.updatedAt || new Date().toISOString(),
      updatedAt: legacy.updatedAt || new Date().toISOString()
    }] : [];
  }
  const projects: SourceCodeProject[] = [];
  for (const entry of await fsp.readdir(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(projectsDir, entry.name, 'source-project.json');
    if (await exists(manifestPath)) projects.push(await readJson<SourceCodeProject>(manifestPath));
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readSourceReference(projectPath: string) {
  const referencePath = path.join(projectPath, 'source-code', 'reference.json');
  if (!(await exists(referencePath))) return null;
  return readJson<any>(referencePath);
}

export async function writeSourceProject(projectPath: string, sourcePath: string) {
  const entries = await fsp.readdir(sourcePath);
  const detected = detectSourceType(entries);
  const now = new Date().toISOString();
  const name = path.basename(sourcePath) || 'Source Project';
  const id = slugify(name);
  const sourceProject: SourceCodeProject = { id, name, path: sourcePath, ...detected, createdAt: now, updatedAt: now };
  const dir = path.join(projectPath, 'source-code', 'projects', id);
  await fsp.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, 'source-project.json'), sourceProject);
  await fsp.writeFile(path.join(dir, 'index.md'), matter.stringify([
    `# ${name}`,
    '',
    `Directory: ${sourcePath}`,
    '',
    `Detected type: ${sourceProject.detectedType}`,
    '',
    '## Indicators',
    '',
    sourceProject.indicators.length ? sourceProject.indicators.map((item: string) => `- ${item}`).join('\n') : 'No strong indicators found.',
    '',
    '## Component Mapping',
    '',
    'Components can link to this source project from the Components screen.',
    ''
  ].join('\n'), {
    aidd: { type: 'source-code-project', templateVersion: TEMPLATE_VERSION },
    id,
    title: name,
    status: 'active',
    updatedAt: sourceProject.updatedAt
  }), 'utf8');
  await refreshSourceCodeIndex(projectPath);
  return sourceProject;
}

export async function refreshSourceCodeIndex(projectPath: string) {
  const projects = await readSourceProjects(projectPath);
  const dir = path.join(projectPath, 'source-code');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'index.md'), matter.stringify([
    '# Source Code Projects',
    '',
    'These are implementation code locations referenced by this AIDD project. Code is not copied into AIDD; only the reference is tracked.',
    '',
    '## Projects',
    '',
    projects.length ? projects.map((project) => `- **${project.name}** — ${project.detectedType} — ${project.path}`).join('\n') : 'No source code projects have been added yet.',
    ''
  ].join('\n'), {
    aidd: { type: 'source-code-index', templateVersion: TEMPLATE_VERSION },
    status: projects.length ? 'active' : 'draft',
    updatedAt: new Date().toISOString()
  }), 'utf8');
}

export async function writeSourceReference(projectPath: string, sourcePath: string) {
  return writeSourceProject(projectPath, sourcePath);
}

export async function readDecisions(root: string) {
  const dir = path.join(root, 'decisions');
  if (!(await exists(dir))) return [] as Array<{ id: string; title: string; status: string; relativePath: string; body: string; createdAt?: string }>;
  const out: Array<{ id: string; title: string; status: string; relativePath: string; body: string; createdAt?: string }> = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'index.md') continue;
    const full = path.join(dir, entry.name);
    const raw = await fsp.readFile(full, 'utf8');
    const parsed = matter(raw);
    out.push({
      id: String((parsed.data as any).id || entry.name.replace(/\.md$/, '')),
      title: String((parsed.data as any).title || entry.name.replace(/\.md$/, '')),
      status: String((parsed.data as any).status || 'proposed'),
      relativePath: path.relative(root, full).split('\\').join('/'),
      body: parsed.content.trim(),
      createdAt: (parsed.data as any).createdAt
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function refreshDecisionIndex(root: string) {
  const decisions = await readDecisions(root);
  await fsp.mkdir(path.join(root, 'decisions'), { recursive: true });
  const lines = [
    '# Decisions',
    '',
    'Decisions are managed as individual records. Do not put all decisions in one shared file.',
    '',
    '## Active decision records',
    '',
    decisions.length ? decisions.map((item) => `- [${item.id} · ${item.title}](./${path.basename(item.relativePath)}) — ${item.status}`).join('\n') : 'No decision records yet.',
    ''
  ];
  await fsp.writeFile(path.join(root, 'decisions', 'index.md'), lines.join('\n'), 'utf8');
}

export async function createDecisionRecord(input: DecisionInput) {
  if (!input.title.trim()) throw new Error('Decision title is required.');
  const slug = slugify(input.title);
  const id = `DEC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${slug}`;
  const dir = path.join(input.projectPath, 'decisions');
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.md`);
  if (await exists(filePath)) throw new Error(`Decision already exists: ${id}`);
  const content = matter.stringify([
    '# Context',
    '',
    input.context?.trim() || 'TODO: Explain the situation or problem.',
    '',
    '# Decision',
    '',
    input.decision?.trim() || 'TODO: State the decision.',
    '',
    '# Consequences',
    '',
    input.consequences?.trim() || 'TODO: Describe trade-offs and follow-up work.',
    ''
  ].join('\n'), {
    aidd: { type: 'decision', templateVersion: TEMPLATE_VERSION },
    id,
    title: input.title.trim(),
    status: input.status || 'proposed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await fsp.writeFile(filePath, content, 'utf8');
  await refreshDecisionIndex(input.projectPath);
  return readDecisions(input.projectPath);
}

export async function ensureProjectGitIgnore(projectPath: string) {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const requiredEntries = ['.aidd-app/', '.aidd/drag-files/', 'node_modules/', 'dist/'];

  let existing = '';
  if (await exists(gitignorePath)) {
    existing = await fsp.readFile(gitignorePath, 'utf8');
  }

  const existingLines = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const missing = requiredEntries.filter((entry) => !existingLines.has(entry));

  if (missing.length === 0) {
    return;
  }

  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n` : '';
  await fsp.writeFile(gitignorePath, `${prefix}${missing.join('\n')}\n`, 'utf8');
}

export async function initialiseGit(projectPath: string, projectName: string, identity: { authorName: string; authorEmail: string }) {
  await ensureProjectGitIgnore(projectPath);
  await git.init({ fs, dir: projectPath, defaultBranch: AIDD_DEFAULT_BRANCH });
  await git.setConfig({ fs, dir: projectPath, path: 'user.name', value: identity.authorName });
  await git.setConfig({ fs, dir: projectPath, path: 'user.email', value: identity.authorEmail });

  const files = await collectFiles(projectPath);
  for (const filepath of files) await git.add({ fs, dir: projectPath, filepath });

  await git.commit({
    fs,
    dir: projectPath,
    message: 'Initial AIDD project',
    author: { name: identity.authorName, email: identity.authorEmail }
  });

  await writeJson(path.join(projectPath, '.aidd-app', 'git.json'), {
    initialized: true,
    defaultBranch: AIDD_DEFAULT_BRANCH,
    projectName,
    createdAt: new Date().toISOString()
  });
}

export async function collectFiles(root: string, current = root): Promise<string[]> {
  const ignored = new Set(['.git', 'node_modules', '.aidd-app']);
  const out: string[] = [];
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) out.push(...await collectFiles(root, full));
    else out.push(path.relative(root, full).split('\\').join('/'));
  }
  return out;
}
