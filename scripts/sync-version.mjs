import { readFileSync, writeFileSync } from "node:fs";

const rawVersion = process.argv[2]?.trim();

if (!rawVersion) {
	console.error("Usage: node scripts/sync-version.mjs <version>");
	process.exit(1);
}

const version = rawVersion.replace(/^refs\/tags\//, "").replace(/^v/i, "");
const semverPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!semverPattern.test(version)) {
	console.error(
		`Invalid version "${rawVersion}". Expected a semantic version like v1.2.3 or 1.2.3-beta.1.`,
	);
	process.exit(1);
}

const readText = (path) => readFileSync(path, "utf8");
const writeText = (path, content) => writeFileSync(path, content, "utf8");

const updateJsonVersion = (path) => {
	const content = readText(path);
	JSON.parse(content);

	const versionPattern = /("version"\s*:\s*)"[^"]+"/;

	if (!versionPattern.test(content)) {
		console.error(`Failed to update version in ${path}.`);
		process.exit(1);
	}

	writeText(path, content.replace(versionPattern, `$1"${version}"`));
};

const updateCargoVersion = (path) => {
	const content = readText(path);
	const packageVersionPattern = /(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/;

	if (!packageVersionPattern.test(content)) {
		console.error(`Failed to update package version in ${path}.`);
		process.exit(1);
	}

	const nextContent = content.replace(packageVersionPattern, `$1"${version}"`);
	writeText(path, nextContent);
};

updateJsonVersion("package.json");
updateJsonVersion("src-tauri/tauri.conf.json");
updateCargoVersion("src-tauri/Cargo.toml");

console.log(`Synced app version to ${version}`);
