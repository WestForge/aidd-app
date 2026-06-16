import { dump, load } from 'js-yaml';

type FrontmatterData = any;

interface FrontmatterResult {
  data: FrontmatterData;
  content: string;
}

function hasFrontmatterData(data: FrontmatterData) {
  if (!data) return false;
  if (typeof data !== 'object') return true;
  return Object.keys(data).length > 0;
}

function normaliseContent(content: string) {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function parseFrontmatter(markdown: string): FrontmatterResult {
  const text = markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown;
  const firstLineMatch = /^---\r?\n/.exec(text);
  if (!firstLineMatch) return { data: {}, content: text };

  const closingDelimiter = /\r?\n---[ \t]*(?:\r?\n|$)/g;
  closingDelimiter.lastIndex = firstLineMatch[0].length;
  const match = closingDelimiter.exec(text);
  if (!match) return { data: {}, content: text };

  const yamlText = text.slice(firstLineMatch[0].length, match.index);
  const data = load(yamlText) ?? {};
  const content = text.slice(match.index + match[0].length);
  return { data, content };
}

parseFrontmatter.stringify = (content: string, data: FrontmatterData) => {
  const body = normaliseContent(content);
  if (!hasFrontmatterData(data)) return body;

  const yamlText = dump(data, { lineWidth: -1 }).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
};

export default parseFrontmatter;
