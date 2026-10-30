// Gera a lista de projetos do README a partir dos repositórios públicos.
// Uso local: GITHUB_TOKEN=$(gh auth token) node scripts/update-readme.mjs

import { readFile, writeFile } from "node:fs/promises";

const USER = "luuizz";
const README = new URL("../README.md", import.meta.url);
const MAX_DESCRIPTION = 90;

// Repositórios que não entram na lista, mesmo sendo públicos.
const HIDDEN = new Set([USER, "social-tree-discover"]);

// Descrições para repositórios que não têm uma no GitHub.
const DESCRIPTIONS = {
  "frontdev-theme": "Tema WordPress do FrontDev.",
  "mv-slider-plugin": "Plugin de slider para WordPress, com post type e shortcode próprios.",
  orbit: "API com Fastify, Drizzle ORM e PostgreSQL.",
};

const GROUPS = [
  { id: "wordpress", title: "WordPress" },
  { id: "laravel", title: "Laravel" },
  { id: "react", title: "React & Next.js" },
  { id: "angular", title: "Angular" },
  { id: "node", title: "Node.js" },
  { id: "other", title: "HTML, CSS & PHP" },
];

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

async function github(path, accept = "application/vnd.github+json") {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
    },
  });
  if (response.status === 404 || response.status === 409) return null;
  if (!response.ok) throw new Error(`GitHub ${response.status} em ${path}`);
  return accept.includes("raw") ? response.text() : response.json();
}

async function listPublicRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await github(`/users/${USER}/repos?type=owner&per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((repo) => !repo.private && !repo.fork && !repo.archived && !HIDDEN.has(repo.name));
}

const readFileFromRepo = (repo, path) =>
  github(`/repos/${USER}/${repo}/contents/${path}`, "application/vnd.github.raw+json");

async function readJson(repo, path) {
  try {
    return JSON.parse(await readFileFromRepo(repo, path));
  } catch {
    return {};
  }
}

async function isWordPress(repo, files, deps) {
  const name = repo.name.toLowerCase();
  if (name.includes("wordpress") || repo.topics?.includes("wordpress")) return true;
  if (deps["@wordpress/scripts"] || files.has("wp-content")) return true;
  if (files.has("style.css") && (await readFileFromRepo(repo.name, "style.css"))?.includes("Theme Name:")) return true;

  const phpFiles = [...files].filter((file) => file.endsWith(".php")).slice(0, 5);
  for (const file of phpFiles) {
    if ((await readFileFromRepo(repo.name, file))?.includes("Plugin Name:")) return true;
  }
  return false;
}

// Retorna null para repositórios vazios.
async function inspect(repo) {
  const contents = await github(`/repos/${USER}/${repo.name}/contents`);
  if (!Array.isArray(contents) || contents.length === 0) return null;

  const files = new Set(contents.map((item) => item.name));
  const pkg = files.has("package.json") ? await readJson(repo.name, "package.json") : {};
  const composer = files.has("composer.json") ? await readJson(repo.name, "composer.json") : {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const isLaravel = Boolean(composer.require?.["laravel/framework"]) || files.has("artisan");
  const isWp = await isWordPress(repo, files, deps);
  const isAngular = Boolean(deps["@angular/core"]);
  const isReact = Boolean(deps.next || deps.react);
  const isNode = Boolean(deps.fastify || deps.express || deps["@nestjs/core"]);

  const group = isWp ? "wordpress" : isLaravel ? "laravel" : isReact ? "react" : isAngular ? "angular" : isNode ? "node" : "other";

  const stack = [
    isLaravel && "Laravel",
    isWp && "WordPress",
    deps.next && "Next.js",
    deps.react && !deps.next && "React",
    isAngular && "Angular",
    deps.fastify && "Fastify",
    deps.typescript && "TypeScript",
    deps.tailwindcss && "Tailwind",
    (deps.sass || repo.language === "SCSS") && "Sass",
    deps.gsap && "GSAP",
    deps.gulp && "Gulp",
    files.has("docker-compose.yml") && "Docker",
  ].filter(Boolean);
  if (stack.length === 0 && repo.language) stack.push(repo.language);

  return { repo, group, stack: stack.slice(0, 4), demo: await checkedHomepage(repo.homepage) };
}

// Só mantém o link de demo se o site estiver respondendo.
async function checkedHomepage(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    return response.status < 400 ? url : null;
  } catch {
    return null;
  }
}

async function inspectAll(repos) {
  const results = [];
  for (let i = 0; i < repos.length; i += 8) {
    results.push(...(await Promise.all(repos.slice(i, i + 8).map(inspect))));
  }
  return results.filter(Boolean);
}

function describe({ repo }) {
  const text = (DESCRIPTIONS[repo.name] ?? repo.description ?? "—").trim().replaceAll("|", "\\|");
  if (text.length <= MAX_DESCRIPTION) return text;
  return `${text.slice(0, MAX_DESCRIPTION).replace(/\s+\S*$/, "")}…`;
}

function formatDate(iso) {
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}`;
}

function renderTable(items) {
  const rows = items.map((item) => {
    const { repo, stack, demo } = item;
    const link = demo ? `[Abrir](${demo})` : "—";
    return `| [${repo.name}](${repo.html_url}) | ${describe(item)} | ${stack.join(", ") || "—"} | ${link} | ${formatDate(repo.pushed_at)} |`;
  });
  return ["| Projeto | Sobre | Stack | Demo | Atualizado |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

function renderGroup(group, items) {
  const label = items.length === 1 ? "1 projeto" : `${items.length} projetos`;
  return [
    "<details>",
    `<summary><strong>${group.title}</strong> · ${label}</summary>`,
    "",
    renderTable(items),
    "",
    "</details>",
  ].join("\n");
}

function renderProjects(items) {
  const sorted = [...items].sort((a, b) => b.repo.pushed_at.localeCompare(a.repo.pushed_at));
  return GROUPS.map((group) => [group, sorted.filter((item) => item.group === group.id)])
    .filter(([, groupItems]) => groupItems.length > 0)
    .map(([group, groupItems]) => renderGroup(group, groupItems))
    .join("\n\n");
}

function replaceBlock(text, name, content) {
  const pattern = new RegExp(`(<!-- ${name}:inicio -->)[\\s\\S]*?(<!-- ${name}:fim -->)`);
  if (!pattern.test(text)) throw new Error(`Marcador "${name}" não encontrado no README`);
  return text.replace(pattern, (_, start, end) => `${start}\n${content}\n${end}`);
}

const items = await inspectAll(await listPublicRepos());

const readme = await readFile(README, "utf8");
await writeFile(README, replaceBlock(readme, "projetos", renderProjects(items)));

console.log(`${items.length} repositórios listados`);
