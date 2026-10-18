import { readFileSync, writeFileSync } from "fs";

// `npm version <x.y.z>` sets the version in package.json; this copies it to manifest.json
// and records the minAppVersion it needs in versions.json.
const targetVersion = process.env.npm_package_version;

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!(targetVersion in versions)) {
  versions[targetVersion] = minAppVersion;
  writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
}
