import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_NAME = "catalogo-marsom-api-brunomarsom";
const DATABASE_NAME = "catalogo-marsom-db";
const BUCKET_NAME = "catalogo-marsom-media";
const currentDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(currentDir, "wrangler.jsonc");
const schemaPath = join(currentDir, "schema.sql");
const logPath = join(currentDir, "wrangler.log");

if (!process.env.CLOUDFLARE_API_TOKEN) {
  throw new Error(
    "O secret CLOUDFLARE_API_TOKEN ainda não foi configurado no GitHub.",
  );
}

if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
  throw new Error(
    "O secret CLOUDFLARE_ACCOUNT_ID ainda não foi configurado no GitHub.",
  );
}

if (!process.env.CATALOGO_EDIT_KEY || process.env.CATALOGO_EDIT_KEY.length < 10) {
  throw new Error(
    "O secret CATALOGO_EDIT_KEY precisa ter pelo menos 10 caracteres.",
  );
}

const commandEnv = {
  ...process.env,
  WRANGLER_LOG_PATH: logPath,
};

function wrangler(
  args,
  { capture = false, allowFailure = false, input } = {},
) {
  try {
    return execFileSync(
      "npx",
      ["--yes", "wrangler@4.92.0", ...args],
      {
        cwd: currentDir,
        env: commandEnv,
        input,
        encoding: "utf8",
        stdio:
          input !== undefined
            ? ["pipe", "inherit", "inherit"]
            : capture
              ? ["ignore", "pipe", "pipe"]
              : "inherit",
      },
    );
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`A Cloudflare retornou uma resposta inválida ao listar ${label}.`);
  }
}

function findDatabase() {
  const databases = parseJson(
    wrangler(["d1", "list", "--json"], { capture: true }),
    "bancos D1",
  );
  return databases.find((database) => database.name === DATABASE_NAME);
}

function writeConfig(databaseId) {
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        $schema: "node_modules/wrangler/config-schema.json",
        name: PROJECT_NAME,
        pages_build_output_dir: "./public",
        compatibility_date: "2026-07-23",
        d1_databases: [
          {
            binding: "DB",
            database_name: DATABASE_NAME,
            database_id: databaseId,
          },
        ],
        r2_buckets: [
          {
            binding: "BUCKET",
            bucket_name: BUCKET_NAME,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

console.log("Verificando o banco compartilhado...");
let database = findDatabase();
if (!database) {
  wrangler(["d1", "create", DATABASE_NAME, "--location", "enam"]);
  database = findDatabase();
}
const databaseId = database?.uuid ?? database?.id;
if (!databaseId) {
  throw new Error("Não foi possível identificar o banco D1 criado.");
}

console.log("Verificando o armazenamento de fotos e vídeos...");
const bucketExists = Boolean(
  wrangler(["r2", "bucket", "info", BUCKET_NAME, "--json"], {
    capture: true,
    allowFailure: true,
  }),
);
if (!bucketExists) {
  wrangler(["r2", "bucket", "create", BUCKET_NAME, "--location", "enam"]);
}

console.log("Verificando o serviço da API...");
const projects = parseJson(
  wrangler(["pages", "project", "list", "--json"], { capture: true }),
  "projetos Pages",
);
const projectExists = projects.some(
  (project) => project["Project Name"] === PROJECT_NAME,
);
if (!projectExists) {
  wrangler([
    "pages",
    "project",
    "create",
    PROJECT_NAME,
    "--production-branch",
    "main",
    "--compatibility-date",
    "2026-07-23",
  ]);
}

console.log("Protegendo as alterações com o código da equipe...");
wrangler(
  ["pages", "secret", "put", "EDIT_KEY", "--project-name", PROJECT_NAME],
  { input: `${process.env.CATALOGO_EDIT_KEY}\n` },
);

writeConfig(databaseId);

console.log("Preparando as tabelas...");
wrangler([
  "d1",
  "execute",
  DATABASE_NAME,
  "--config",
  configPath,
  "--remote",
  "--file",
  schemaPath,
  "--yes",
]);

console.log("Publicando a API...");
wrangler([
  "pages",
  "deploy",
  "public",
  "--project-name",
  PROJECT_NAME,
  "--branch",
  "main",
  "--commit-dirty",
  "false",
]);

console.log(
  "API publicada: https://catalogo-marsom-api-brunomarsom.pages.dev",
);
