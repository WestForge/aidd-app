#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const forceComplete = args.includes('--mark-non-todo-complete');
const projectArg = args.find((arg) => !arg.startsWith('--'));
const projectRoot = path.resolve(projectArg ?? process.cwd());

const TEMPLATE_ID = 'aidd-default';
const TEMPLATE_VERSION = '0.8.0';

const changes = [];
const warnings = [];

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readText(target) {
  return fs.readFile(target, 'utf8');
}

async function writeText(target, content) {
  changes.push(`write ${path.relative(projectRoot, target)}`);
  if (!dryRun) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
}

async function ensureDir(target) {
  if (!(await exists(target))) {
    changes.push(`create directory ${path.relative(projectRoot, target)}`);
    if (!dryRun) await fs.mkdir(target, { recursive: true });
  }
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function hasFrontmatter(content) {
  return content.startsWith('---\n') || content.startsWith('---\r\n');
}

function looksComplete(content) {
  const stripped = content.replace(/^---[\s\S]*?---\s*/m, '').trim();
  if (!stripped) return false;
  if (/TODO:/i.test(stripped)) return false;
  if (/^#\s+.+\n\s*$/m.test(stripped) && stripped.split(/\r?\n/).length <= 3) return false;
  return true;
}

function frontmatter(type, id, title, status = 'draft', required = true) {
  return `---\naidd:\n  type: ${type}\n  id: ${id}\n  title: ${title}\n  status: ${status}\n  required: ${required}\n  templateVersion: ${TEMPLATE_VERSION}\n  updatedAt: ${new Date().toISOString()}\n---\n\n`;
}

async function ensureMarkdownFile(relativePath, meta, body) {
  const target = path.join(projectRoot, relativePath);
  if (!(await exists(target))) {
    await writeText(target, frontmatter(meta.type, meta.id, meta.title, meta.status ?? 'draft', meta.required ?? true) + body.trim() + '\n');
    return;
  }

  const current = await readText(target);
  if (!hasFrontmatter(current)) {
    const inferredStatus = forceComplete && looksComplete(current) ? 'complete' : (meta.status ?? 'draft');
    await writeText(target, frontmatter(meta.type, meta.id, meta.title, inferredStatus, meta.required ?? true) + current.trim() + '\n');
  }
}

async function ensureJsonFile(relativePath, fallback) {
  const target = path.join(projectRoot, relativePath);
  if (!(await exists(target))) {
    await writeText(target, JSON.stringify(fallback, null, 2) + '\n');
    return;
  }

  try {
    JSON.parse(await readText(target));
  } catch {
    warnings.push(`${relativePath} exists but is not valid JSON. It was not overwritten.`);
  }
}

async function migrateOldFolder(oldName, newName) {
  const oldPath = path.join(projectRoot, oldName);
  const newPath = path.join(projectRoot, newName);
  if ((await exists(oldPath)) && !(await exists(newPath))) {
    changes.push(`rename ${oldName} -> ${newName}`);
    if (!dryRun) await fs.rename(oldPath, newPath);
  }
}

async function removeEmptyObsoleteFoundationFiles() {
  const obsoleteFiles = [
    'foundation/01-project-overview.md',
    'foundation/04-decisions.md',
    'foundation/05-decision-ledger.md',
    'foundation/06-delivery-rules.md'
  ];

  for (const rel of obsoleteFiles) {
    const target = path.join(projectRoot, rel);
    if (!(await exists(target))) continue;
    const content = await readText(target);
    const userContent = content.replace(/^---[\s\S]*?---\s*/m, '').replace(/^#.*$/m, '').trim();
    if (!userContent || /^TODO:/i.test(userContent)) {
      const archivePath = path.join(projectRoot, '_archive', rel);
      changes.push(`archive obsolete empty file ${rel}`);
      if (!dryRun) {
        await fs.mkdir(path.dirname(archivePath), { recursive: true });
        await fs.rename(target, archivePath);
      }
    } else {
      warnings.push(`${rel} is obsolete but contains content. Review it manually before removing.`);
    }
  }
}

async function repair() {
  if (!(await exists(projectRoot))) {
    throw new Error(`Project path does not exist: ${projectRoot}`);
  }

  await migrateOldFolder('common', 'foundation');
  await migrateOldFolder('modules', 'components');
  await migrateOldFolder('bundles', 'delivery/packages');

  const directories = [
    'foundation',
    'foundation/standards',
    'foundation/delivery-planning',
    'capabilities',
    'components',
    'changes',
    'delivery',
    'delivery/packages',
    'source-code',
    'source-code/projects',
    '.aidd'
  ];

  for (const dir of directories) await ensureDir(path.join(projectRoot, dir));

  await ensureJsonFile('aidd.template.json', {
    templateId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    repairedAt: new Date().toISOString()
  });

  await ensureMarkdownFile('foundation/02-product-definition.md', {
    type: 'foundation',
    id: 'product-definition',
    title: 'Product Definition',
    status: 'draft',
    required: true
  }, `# Product Definition\n\nDescribe what the system is, what it should make possible, and the product context every delivery package should inherit.`);

  await ensureMarkdownFile('foundation/03-audience-and-users.md', {
    type: 'foundation',
    id: 'audience-and-users',
    title: 'Audience & Users',
    status: 'draft',
    required: true
  }, `# Audience and Users\n\nDescribe who uses the system, who maintains it, and what outcomes matter to them.`);

  await ensureMarkdownFile('foundation/standards/index.md', {
    type: 'standards',
    id: 'project-standards',
    title: 'Project Standards',
    status: 'draft',
    required: true
  }, `# Project Standards\n\n## Software Types\n\n- TODO: Select the software types used by this project.\n\n## Design Standards\n\n- TODO: Select the software design standards that apply.\n\n## Coding, Testing, and Quality\n\n- TODO: Define coding style, testing expectations, and quality checks.`);

  await ensureMarkdownFile('foundation/delivery-planning/index.md', {
    type: 'delivery-planning',
    id: 'delivery-planning',
    title: 'Delivery Planning',
    status: 'draft',
    required: true
  }, `# Delivery Planning\n\n## Breakdown Approach\n\nDefine how capabilities should be broken into delivery packages.\n\n## Source Code Review\n\nDefine how mapped source code should be reviewed before implementation planning.\n\n## Implementation Strategy\n\nDefine how implementation plans should be created.\n\n## Testing Strategy\n\nDefine how standards influence testing and verification.\n\n## AI Review Criteria\n\nDefine how AI output should be reviewed against source code, capabilities, components, and standards.\n\n## Required Evidence\n\nDefine what evidence is required before a delivery package can be accepted.`);

  await ensureMarkdownFile('changes/index.md', {
    type: 'changes-index',
    id: 'changes',
    title: 'Changes',
    status: 'draft',
    required: true
  }, `# Changes\n\nChanges describe intended product, component, technical, documentation, or investigation work before it is scheduled for delivery.\n\n## Active changes\n\nNo changes yet.`);

  await removeEmptyObsoleteFoundationFiles();

  const report = [
    '# AIDD Repair Report',
    '',
    `Project: ${projectRoot}`,
    `Mode: ${dryRun ? 'dry-run' : 'applied'}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Changes',
    '',
    ...(changes.length ? changes.map((item) => `- ${item}`) : ['- No changes required.']),
    '',
    '## Warnings',
    '',
    ...(warnings.length ? warnings.map((item) => `- ${item}`) : ['- No warnings.']),
    ''
  ].join('\n');

  const reportPath = path.join(projectRoot, '.aidd', 'repair-report.md');
  await writeText(reportPath, report);

  console.log(report);
}

repair().catch((error) => {
  console.error(`AIDD repair failed: ${error.message}`);
  process.exitCode = 1;
});
