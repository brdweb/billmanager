import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseAllDocuments } from 'yaml';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flowsRoot = path.join(mobileRoot, '.maestro');

const expectedFlows = new Set([
  'android/auth-entry.yaml',
  'android/design-preview-main-tabs.yaml',
  'android/design-preview-offline-conflicts.yaml',
  'ios/auth-entry.yaml',
  'ios/design-preview-main-tabs.yaml',
  'ios/design-preview-offline-conflicts.yaml',
]);

const appIds = {
  android: 'com.brdweb.billmanagermobile',
  ios: 'com.brdweb.billmanager',
};

const allowedCommands = new Set([
  'assertVisible',
  'extendedWaitUntil',
  'launchApp',
  'scrollUntilVisible',
  'tapOn',
]);

function fail(message) {
  throw new Error(`Maestro flow validation failed: ${message}`);
}

async function listYamlFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'README.md') continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listYamlFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
      files.push(relative);
    }
  }
  return files.sort();
}

function parseFlow(relativePath, source) {
  if (source.includes('\t')) fail(`${relativePath} contains a tab; use spaces in YAML`);

  const documents = parseAllDocuments(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  const errors = documents.flatMap((document) => document.errors);
  if (errors.length > 0) fail(`${relativePath} is invalid YAML: ${errors[0].message}`);
  if (documents.length !== 2) {
    fail(`${relativePath} must contain one configuration document and one command document separated by ---`);
  }

  const header = documents[0].toJS();
  const commands = documents[1].toJS();
  return { header, commands };
}

function validateHeader(relativePath, header) {
  const platform = relativePath.split('/')[0];
  if (!(platform in appIds)) fail(`${relativePath} must live under android/ or ios/`);
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    fail(`${relativePath} configuration must be a mapping`);
  }
  if (header.appId !== appIds[platform]) {
    fail(`${relativePath} must target ${appIds[platform]}`);
  }
  if (typeof header.name !== 'string' || header.name.trim().length < 5) {
    fail(`${relativePath} needs a descriptive name`);
  }
  if (!Array.isArray(header.tags) || !header.tags.every((tag) => typeof tag === 'string')) {
    fail(`${relativePath} tags must be a string array`);
  }
  if (!header.tags.includes(platform) || !header.tags.includes('smoke')) {
    fail(`${relativePath} must include ${platform} and smoke tags`);
  }
}

function commandName(relativePath, command, index) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    fail(`${relativePath} command ${index + 1} must be a mapping`);
  }
  const keys = Object.keys(command);
  if (keys.length !== 1) fail(`${relativePath} command ${index + 1} must contain exactly one command`);
  if (!allowedCommands.has(keys[0])) fail(`${relativePath} uses unsupported command ${keys[0]}`);
  return keys[0];
}

function validateCommands(relativePath, header, commands) {
  if (!Array.isArray(commands) || commands.length < 4) {
    fail(`${relativePath} must contain a non-trivial command sequence`);
  }
  const names = commands.map((command, index) => commandName(relativePath, command, index));
  if (names[0] !== 'launchApp' || commands[0].launchApp?.clearState !== true) {
    fail(`${relativePath} must begin with launchApp and clearState: true`);
  }
  const assertionCount = names.filter((name) => name === 'assertVisible' || name === 'extendedWaitUntil').length;
  if (assertionCount < 3) fail(`${relativePath} needs at least three visible-state gates`);

  const serialized = JSON.stringify(commands);
  if (relativePath.endsWith('/auth-entry.yaml')) {
    if (!header.tags.includes('auth')) fail(`${relativePath} must include the auth tag`);
    for (const marker of ['auth-login-screen', 'auth-forgot-screen', 'Change server']) {
      if (!serialized.includes(marker)) fail(`${relativePath} is missing auth coverage marker ${marker}`);
    }
  } else if (relativePath.endsWith('/design-preview-main-tabs.yaml')) {
    if (!header.tags.includes('preview')) fail(`${relativePath} must include the preview tag`);
    for (const marker of ['Home', 'Bills', 'Calendar', 'Insights', 'Settings']) {
      if (!serialized.includes(marker)) fail(`${relativePath} is missing tab coverage for ${marker}`);
    }
  } else if (relativePath.endsWith('/design-preview-offline-conflicts.yaml')) {
    if (!header.tags.includes('preview')) fail(`${relativePath} must include the preview tag`);
    for (const marker of ['Sync & offline data', 'Retry now', 'No conflicts need your input', 'syncs changes automatically']) {
      if (!serialized.includes(marker)) fail(`${relativePath} is missing offline/conflict coverage marker ${marker}`);
    }
  }
}

const flowFiles = await listYamlFiles(flowsRoot);
const actualFlows = new Set(flowFiles);
for (const expected of expectedFlows) {
  if (!actualFlows.has(expected)) fail(`missing required flow ${expected}`);
}
for (const actual of actualFlows) {
  if (!expectedFlows.has(actual)) fail(`unexpected YAML file ${actual}; add it to the validated suite manifest`);
}

for (const relativePath of flowFiles) {
  const source = await readFile(path.join(flowsRoot, relativePath), 'utf8');
  const { header, commands } = parseFlow(relativePath, source);
  validateHeader(relativePath, header);
  validateCommands(relativePath, header, commands);
}

console.log(`Validated ${flowFiles.length} Maestro flows for Android and iOS.`);
