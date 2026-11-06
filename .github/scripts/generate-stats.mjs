// Generates the GitHub stats and top-languages cards for the profile README.
// Runs in GitHub Actions (see .github/workflows/profile-stats.yml) so the README
// does not depend on a public third-party image service.
//
// Usage:
//   GITHUB_TOKEN=... GITHUB_USER=YurMil node .github/scripts/generate-stats.mjs
//   node .github/scripts/generate-stats.mjs --demo   # render with sample data

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = process.env.OUT_DIR || "assets";
const USER = process.env.GITHUB_USER || "YurMil";
const TOKEN = process.env.GITHUB_TOKEN;
const DEMO = process.argv.includes("--demo");
const TOP_LANGS = 6;

const THEMES = {
  light: {
    title: "#1B4F8A",
    text: "#24292F",
    muted: "#57606A",
    border: "#D0D7DE",
    accentFrom: "#1B4F8A",
    accentTo: "#6E56CF",
    track: "#EAEEF2",
  },
  dark: {
    title: "#4F8EF7",
    text: "#E6EDF3",
    muted: "#8B949E",
    border: "#30363D",
    accentFrom: "#4F8EF7",
    accentTo: "#8B7CF6",
    track: "#21262D",
  },
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

// ---------------------------------------------------------------- data

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats-generator",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchStats() {
  const userQuery = `
    query($login: String!) {
      user(login: $login) {
        name
        followers { totalCount }
        contributionsCollection {
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
          contributionCalendar { totalContributions }
        }
      }
    }`;
  const reposQuery = `
    query($login: String!, $after: String) {
      user(login: $login) {
        repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name color } }
            }
          }
        }
      }
    }`;

  const { user } = await graphql(userQuery, { login: USER });
  if (!user) throw new Error(`User ${USER} not found`);

  let stars = 0;
  let repoCount = 0;
  const langs = new Map();
  let after = null;
  do {
    const data = await graphql(reposQuery, { login: USER, after });
    const page = data.user.repositories;
    repoCount = page.totalCount;
    for (const repo of page.nodes) {
      stars += repo.stargazerCount;
      for (const { size, node } of repo.languages.edges) {
        const cur = langs.get(node.name) || { name: node.name, color: node.color, size: 0 };
        cur.size += size;
        langs.set(node.name, cur);
      }
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  const cc = user.contributionsCollection;
  return {
    stats: {
      contributions: cc.contributionCalendar.totalContributions,
      commits: cc.totalCommitContributions,
      prs: cc.totalPullRequestContributions,
      issues: cc.totalIssueContributions,
      stars,
      repos: repoCount,
      followers: user.followers.totalCount,
    },
    languages: [...langs.values()].sort((a, b) => b.size - a.size),
  };
}

function demoData() {
  return {
    stats: { contributions: 1248, commits: 972, prs: 64, issues: 21, stars: 87, repos: 18, followers: 42 },
    languages: [
      { name: "TypeScript", color: "#3178c6", size: 520000 },
      { name: "JavaScript", color: "#f1e05a", size: 210000 },
      { name: "Python", color: "#3572A5", size: 90000 },
      { name: "C#", color: "#178600", size: 60000 },
      { name: "CSS", color: "#563d7c", size: 40000 },
      { name: "HTML", color: "#e34c26", size: 25000 },
      { name: "Shell", color: "#89e051", size: 5000 },
    ],
  };
}

// ---------------------------------------------------------------- render

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString("en-US"));

function frame({ width, height, title, theme, body }) {
  const t = THEMES[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${t.accentFrom}"/>
      <stop offset="1" stop-color="${t.accentTo}"/>
    </linearGradient>
  </defs>
  <style>
    text { font-family: ${FONT}; }
    .fade { opacity: 0; animation: fade .6s ease-out forwards; }
    @keyframes fade { to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .fade { animation: none; opacity: 1; } }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="none" stroke="${t.border}"/>
  <rect x="24" y="22" width="4" height="18" rx="2" fill="url(#accent)"/>
  <text x="38" y="37" font-size="17" font-weight="600" fill="${t.title}">${esc(title)}</text>
${body}
</svg>
`;
}

function renderStats(stats, theme) {
  const t = THEMES[theme];
  const width = 440;
  const height = 190;
  const tiles = [
    { value: stats.contributions, label: "Contributions (1y)" },
    { value: stats.commits, label: "Commits (1y)" },
    { value: stats.prs, label: "Pull requests (1y)" },
    { value: stats.stars, label: "Stars earned" },
    { value: stats.repos, label: "Public repos" },
    { value: stats.followers, label: "Followers" },
  ];
  const colW = (width - 48) / 3;
  const body = tiles
    .map((tile, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 24 + col * colW;
      const y = 82 + row * 62;
      return `  <g class="fade" style="animation-delay:${0.08 * i}s">
    <text x="${x}" y="${y}" font-size="26" font-weight="700" fill="${t.text}">${fmt(tile.value)}</text>
    <text x="${x}" y="${y + 20}" font-size="12" fill="${t.muted}">${esc(tile.label)}</text>
  </g>`;
    })
    .join("\n");
  return frame({ width, height, title: "GitHub at a glance", theme, body });
}

function renderLangs(languages, theme) {
  const t = THEMES[theme];
  const width = 340;
  const height = 190;
  const top = languages.slice(0, TOP_LANGS);
  const total = top.reduce((s, l) => s + l.size, 0) || 1;

  // Stacked bar
  const barX = 24;
  const barY = 56;
  const barW = width - 48;
  const barH = 10;
  let cursor = barX;
  const segments = top
    .map((l) => {
      const w = (l.size / total) * barW;
      const seg = `    <rect x="${cursor.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}" fill="${l.color || t.muted}"/>`;
      cursor += w;
      return seg;
    })
    .join("\n");
  const bar = `  <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="5"/></clipPath>
  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="5" fill="${t.track}"/>
  <g clip-path="url(#bar)">
${segments}
  </g>`;

  // Legend in two columns
  const colW = barW / 2;
  const legend = top
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = barX + col * colW;
      const y = 98 + row * 28;
      const pct = ((l.size / total) * 100).toFixed(1);
      return `  <g class="fade" style="animation-delay:${0.08 * i}s">
    <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color || t.muted}"/>
    <text x="${x + 16}" y="${y}" font-size="13" fill="${t.text}">${esc(l.name)}</text>
    <text x="${x + colW - 12}" y="${y}" font-size="12" fill="${t.muted}" text-anchor="end">${pct}%</text>
  </g>`;
    })
    .join("\n");

  const empty = top.length
    ? ""
    : `  <text x="${barX}" y="100" font-size="13" fill="${t.muted}">No language data yet</text>`;

  return frame({ width, height, title: "Top languages", theme, body: `${bar}\n${legend}${empty}` });
}

// ---------------------------------------------------------------- main

async function main() {
  if (!DEMO && !TOKEN) throw new Error("GITHUB_TOKEN is required (or pass --demo)");
  const { stats, languages } = DEMO ? demoData() : await fetchStats();
  await mkdir(OUT_DIR, { recursive: true });
  for (const theme of Object.keys(THEMES)) {
    await writeFile(path.join(OUT_DIR, `stats-${theme}.svg`), renderStats(stats, theme));
    await writeFile(path.join(OUT_DIR, `langs-${theme}.svg`), renderLangs(languages, theme));
  }
  console.log(`Wrote cards to ${OUT_DIR}/`, JSON.stringify(stats));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
