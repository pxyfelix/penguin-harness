import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const source = path.join(pluginRoot, "skills", "feedback-curator", "templates", "feedback.xlsx");
const target = path.join(pluginRoot, "skills", "feedback-curator", "scripts", "template-data.mjs");

const base64 = (await readFile(source)).toString("base64");
const chunks = base64.match(/.{1,100}/g) ?? [];
const body = chunks.map((chunk) => `  "${chunk}",`).join("\n");
await writeFile(target, `export const feedbackTemplateBase64 = [\n${body}\n].join("");\n`, "utf8");
