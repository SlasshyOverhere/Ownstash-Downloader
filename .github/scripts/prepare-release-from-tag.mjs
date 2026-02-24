#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TAG_REGEX = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

const releaseTag = process.env.RELEASE_TAG ?? process.argv[2];
if (!releaseTag) {
    throw new Error("Missing release tag. Pass RELEASE_TAG env (e.g. v1.2.3).");
}

const match = releaseTag.match(TAG_REGEX);
if (!match) {
    throw new Error(`Invalid tag "${releaseTag}". Use semantic version tags like v1.2.3 or v1.2.3-beta.1.`);
}

const releaseVersion = match[1];
const repo = process.env.GITHUB_REPOSITORY;
const expectedUpdaterEndpoint = repo
    ? `https://github.com/${repo}/releases/latest/download/latest.json`
    : null;

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, "package.json");
const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
packageJson.version = releaseVersion;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
tauriConfig.version = releaseVersion;
tauriConfig.bundle = tauriConfig.bundle ?? {};
tauriConfig.bundle.createUpdaterArtifacts = true;

if (expectedUpdaterEndpoint) {
    tauriConfig.plugins = tauriConfig.plugins ?? {};
    tauriConfig.plugins.updater = tauriConfig.plugins.updater ?? {};
    const endpoints = Array.isArray(tauriConfig.plugins.updater.endpoints)
        ? tauriConfig.plugins.updater.endpoints
        : [];
    if (!endpoints.includes(expectedUpdaterEndpoint)) {
        tauriConfig.plugins.updater.endpoints = [expectedUpdaterEndpoint, ...endpoints];
    }
}

fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 4)}\n`, "utf8");

const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
const packageVersionPattern = /(\[package\][\s\S]*?^\s*version\s*=\s*")([^"]+)(")/m;
if (!packageVersionPattern.test(cargoToml)) {
    throw new Error("Unable to locate [package] version in src-tauri/Cargo.toml.");
}
const updatedCargoToml = cargoToml.replace(packageVersionPattern, `$1${releaseVersion}$3`);
fs.writeFileSync(cargoTomlPath, updatedCargoToml, "utf8");

console.log(`Release preparation complete for ${releaseTag}`);
console.log(`- package.json version: ${releaseVersion}`);
console.log(`- src-tauri/Cargo.toml version: ${releaseVersion}`);
console.log(`- src-tauri/tauri.conf.json version: ${releaseVersion}`);
if (expectedUpdaterEndpoint) {
    console.log(`- ensured updater endpoint: ${expectedUpdaterEndpoint}`);
}
