// Gera a lista de projetos do README e o gráfico de linguagens a partir dos repositórios públicos.
// Uso local: GITHUB_TOKEN=$(gh auth token) node scripts/update-readme.mjs

import { mkdir, readFile, writeFile } from "node:fs/promises";

const USER = "luuizz";
const README = new URL("../README.md", import.meta.url);
const CHART = new URL("../assets/linguagens.svg", import.meta.url);
const VISIBLE_ROWS = 6;
const MAX_DESCRIPTION = 90;

// Repositórios que não entram na lista, mesmo sendo públicos.
const HIDDEN = new Set([USER, "social-tree-discover"]);

// Descrições para repositórios que não têm uma no GitHub.
const DESCRIPTIONS = {
  "zap-flutuante": "Plugin de botão flutuante de WhatsApp, com painel em React e rastreio de UTM.",
  "wordpress-docker-boilerplate": "Stack Docker para iniciar projetos WordPress com PHP-FPM, Nginx e MariaDB.",
  "frontdev-theme": "Tema WordPress do FrontDev.",
  "theme-rankdone": "Tema WordPress do blog da Rankdone, com PHP, SCSS e Gulp.",
  "mv-slider-plugin": "Plugin de slider para WordPress, com post type e shortcode próprios.",
  "luizricardo-portfolio": "Meu portfólio pessoal.",
  orbit: "API com Fastify, Drizzle ORM e PostgreSQL.",
};

const GROUPS = [
  { id: "wordpress", title: "WordPress", open: true },
  { id: "laravel", title: "Laravel", open: true },
  { id: "react", title: "React & Next.js", open: true },
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
  const parts = [
    `<details${group.open ? " open" : ""}>`,
    `<summary><strong>${group.title}</strong> · ${label}</summary>`,
    "",
    renderTable(items.slice(0, VISIBLE_ROWS)),
    "",
  ];
  const rest = items.slice(VISIBLE_ROWS);
  if (rest.length > 0) {
    parts.push("<details>", `<summary>Ver mais ${rest.length}</summary>`, "", renderTable(rest), "", "</details>", "");
  }
  parts.push("</details>");
  return parts.join("\n");
}

function renderProjects(items) {
  const sorted = [...items].sort((a, b) => b.repo.pushed_at.localeCompare(a.repo.pushed_at));
  return GROUPS.map((group) => [group, sorted.filter((item) => item.group === group.id)])
    .filter(([, groupItems]) => groupItems.length > 0)
    .map(([group, groupItems]) => renderGroup(group, groupItems))
    .join("\n\n");
}

function countLanguages(items) {
  const counts = new Map();
  for (const { repo } of items) {
    if (repo.language) counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, 6);
  const others = sorted.slice(6).reduce((sum, [, count]) => sum + count, 0);
  if (others > 0) top.push(["Outras", others]);
  return top;
}

function renderChart(languages) {
  const rowHeight = 32;
  const barHeight = 14;
  const labelWidth = 112;
  const valueWidth = 40;
  const width = 640;
  const height = languages.length * rowHeight;
  const scale = (width - labelWidth - valueWidth) / Math.max(...languages.map(([, count]) => count));

  const rows = languages.map(([name, count], index) => {
    const barWidth = Math.max(count * scale, 4);
    const y = index * rowHeight + (rowHeight - barHeight) / 2;
    const textY = index * rowHeight + rowHeight / 2 + 4.5;
    const bar = `M${labelWidth} ${y}h${barWidth - 4}a4 4 0 0 1 4 4v${barHeight - 8}a4 4 0 0 1-4 4h-${barWidth - 4}z`;
    return [
      `  <text class="label" x="${labelWidth - 12}" y="${textY}" text-anchor="end">${name}</text>`,
      `  <path class="bar" d="${bar}"/>`,
      `  <text class="value" x="${labelWidth + barWidth + 8}" y="${textY}">${count}</text>`,
    ].join("\n");
  });

  const summary = languages.map(([name, count]) => `${name}: ${count}`).join(", ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="title">
  <title id="title">Repositórios públicos por linguagem principal. ${summary}</title>
  <style>
    text { font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .label { fill: #6e7781; }
    .value { fill: #6e7781; font-weight: 600; }
    .bar { fill: #2a78d6; }
  </style>
${rows.join("\n")}
</svg>
`;
}

function replaceBlock(text, name, content) {
  const pattern = new RegExp(`(<!-- ${name}:inicio -->)[\\s\\S]*?(<!-- ${name}:fim -->)`);
  if (!pattern.test(text)) throw new Error(`Marcador "${name}" não encontrado no README`);
  return text.replace(pattern, (_, start, end) => `${start}\n${content}\n${end}`);
}

const items = await inspectAll(await listPublicRepos());
const languages = countLanguages(items);
const alt = `Repositórios públicos por linguagem principal. ${languages.map(([name, count]) => `${name}: ${count}`).join(", ")}`;

let readme = await readFile(README, "utf8");
readme = replaceBlock(readme, "projetos", renderProjects(items));
readme = replaceBlock(readme, "linguagens", `<img src="assets/linguagens.svg" width="640" alt="${alt}" />`);

await mkdir(new URL(".", CHART), { recursive: true });
await writeFile(CHART, renderChart(languages));
await writeFile(README, readme);

console.log(`${items.length} repositórios listados`);
