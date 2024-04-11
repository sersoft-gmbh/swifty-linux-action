import * as core from '@actions/core';
import { getExecOutput } from '@actions/exec';
import * as tools from '@actions/tool-cache';
import * as io from '@actions/io';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as util from 'util';
import * as path from 'path';

async function runCmd(cmd: string, ...args: string[]): Promise<string> {
    const output = await getExecOutput(cmd, args.length <= 0 ? undefined : args);
    return output.stdout;
}

async function findMatchingRelease(releaseVersion: string, token: string): Promise<string> {
    type RepositoryData = {
        repository?: {
            refs?: {
                nodes?: { name: string; }[];
            };
        };
    };
    const data = await github.getOctokit(token).graphql<RepositoryData>(`
        query getTags($tagQuery: String!) {
            repository(owner: "apple", name: "swift") {
                refs(refPrefix: "refs/tags/", first: 100, query: $tagQuery, orderBy: { field: ALPHABETICAL, direction: DESC }) {
                    nodes {
                        name
                    }
                }
            }
        }
    `, { tagQuery: `swift-${releaseVersion}` });
    const tagNames = data.repository?.refs?.nodes?.map(n => n.name)
        .filter(n => n.toLowerCase().endsWith('-release')) ?? [];
    if (tagNames.length <= 0) {
        core.info(`No release found for version '${releaseVersion}'. Using version as-is...`);
        return releaseVersion;
    }
    return tagNames[0].split('-')[1];
}

async function install(installBase: string, branchName: string, versionTag: string, platform: string, skipGPGCheck: boolean) {
    const tempPath = await core.group('Setup paths', async () => {
        await io.mkdirP(installBase);
        return await util.promisify(fs.mkdtemp)('swifty-linux-action');
    });

    const swiftPkg = path.join(tempPath, 'swift.tar.gz');
    const swiftSig = path.join(tempPath, 'swift.tar.gz.sig');
    const allKeysFile = path.join(tempPath, 'all-keys.asc');
    await core.group('Downloading files', async () => {
        const swiftURL = `https://download.swift.org/${branchName}/${platform.split('.').join('')}/${versionTag}/${versionTag}-${platform}.tar.gz`;
        core.debug(`Swift Download URL: ${swiftURL}...`)
        let promises: Promise<string>[] = [tools.downloadTool(swiftURL, swiftPkg)];
        if (!skipGPGCheck) {
            promises.push(
                tools.downloadTool(`${swiftURL}.sig`, swiftSig),
                tools.downloadTool('https://swift.org/keys/all-keys.asc', allKeysFile),
            );
        }
        await Promise.all(promises);
    });

    if (!skipGPGCheck) {
        await core.group('Verifying files', async () => {
            try {
                await runCmd('gpg', '--import', allKeysFile);
            } catch (error) {
                core.debug('Failed to import GPG keys from file: ' + error);
                core.debug('Trying to import from keyserver...');
                await runCmd('gpg', '--keyserver', 'hkp://keyserver.ubuntu.com', '--recv-keys',
                    '7463 A81A 4B2E EA1B 551F  FBCF D441 C977 412B 37AD',
                    '1BE1 E29A 084C B305 F397  D62A 9F59 7F4D 21A5 6D5F',
                    'A3BA FD35 56A5 9079 C068  94BD 63BC 1CFE 91D3 06C6',
                    '5E4D F843 FB06 5D7F 7E24  FBA2 EF54 30F0 71E1 B235',
                    '8513 444E 2DA3 6B7C 1659  AF4D 7638 F1FB 2B2B 08C4',
                    'A62A E125 BBBF BB96 A6E0  42EC 925C C1CC ED3D 1561',
                    '8A74 9566 2C3C D4AE 18D9  5637 FAF6 989E 1BC1 6FEA',
                    'E813 C892 820A 6FA1 3755  B268 F167 DF1A CF9C E069');
            }
            let verifyArgs = ['--verify'];
            if (!core.isDebug()) verifyArgs.push('--quiet');
            verifyArgs.push(swiftSig, swiftPkg);
            await runCmd('gpg', ...verifyArgs);
        });
    }

    await core.group('Unpacking files', async () => {
        // We need to pass 'strip-components', so we cannot use 'tools.extractTar'
        await runCmd('tar', 'x', '--strip-components=1', '-C', installBase, '-f', swiftPkg);
        // We need the -R option and want to simply add r (not knowing what the other permissions are), so we use the command line here.
        await runCmd('chmod', '-R', 'o+r', path.join(installBase, '/usr/lib/swift'));
    });

    await core.group('Cleaning up', async () => await io.rmRF(tempPath));
}

async function main() {
    switch (process.platform) {
        case 'linux': break;
        default: throw new Error('This action can only install Swift on linux!');
    }

    core.startGroup('Validate input');
    const swiftReleaseInput = core.getInput('release-version');

    let swiftRelease: string;
    let swiftBranch: string, swiftVersion: string;
    if (!swiftReleaseInput) {
        core.info('`release-version` was not set. Requiring `branch-name` and `version-tag` parameters!');
        swiftBranch = core.getInput('branch-name', { required: true });
        swiftVersion = core.getInput('version-tag', { required: true });
        swiftRelease = swiftReleaseInput;
    } else {
        const token = core.getInput('github-token');
        swiftRelease = token ? await findMatchingRelease(swiftReleaseInput, token) : swiftReleaseInput;
        swiftBranch = `swift-${swiftRelease}-release`;
        swiftVersion = `swift-${swiftRelease}-RELEASE`;
    }

    let swiftPlatform = core.getInput('platform')?.split('-').join('');
    if (!swiftPlatform) {
        core.info('Parameter `platform` was not set. Trying to determine platform...');
        const releaseInfo= await runCmd('lsb_release', '-sir');
        swiftPlatform = releaseInfo.split('\n').map(s => s.toLowerCase()).join('');
        core.info(`Using ${swiftPlatform} as platform.`);
    }
    const skipDependencies= core.getBooleanInput('skip-dependencies');
    const skipGPGCheck= core.getBooleanInput('skip-gpg-check');
    core.endGroup();

    if (!skipDependencies) {
        let dependencies: string[];
        // TODO: Add support for `yum`...
        switch (swiftPlatform) {
            case 'ubuntu16.04':
                dependencies = [
                    'binutils',
                    'git',
                    'libc6-dev',
                    'libcurl3',
                    'libedit2',
                    'libgcc-5-dev',
                    'libpython2.7',
                    'libsqlite3-0',
                    'libstdc++-5-dev',
                    'libxml2',
                    'pkg-config',
                    'tzdata',
                    'zlib1g-dev',
                    'curl',
                ];
                break;
            case 'ubuntu18.04':
                dependencies = [
                    'binutils',
                    'git',
                    'libc6-dev',
                    'libcurl4',
                    'libedit2',
                    'libgcc-5-dev',
                    'libpython2.7',
                    'libsqlite3-0',
                    'libstdc++-5-dev',
                    'libxml2',
                    'pkg-config',
                    'tzdata',
                    'zlib1g-dev',
                ];
                break;
            case 'ubuntu20.04':
                dependencies = [
                    'binutils',
                    'git',
                    'gnupg2',
                    'libc6-dev',
                    'libcurl4',
                    'libedit2',
                    'libgcc-9-dev',
                    'libpython2.7',
                    'libsqlite3-0',
                    'libstdc++-9-dev',
                    'libxml2',
                    'libz3-dev',
                    'pkg-config',
                    'tzdata',
                    'zlib1g-dev',
                ];
                break;
             case 'ubuntu22.04':
                 dependencies = [
                     'binutils',
                     'git',
                     'unzip',
                     'gnupg2',
                     'libc6-dev',
                     'libcurl4-openssl-dev',
                     'libedit2',
                     'libgcc-9-dev',
                     'libpython3.8',
                     'libsqlite3-0',
                     'libstdc++-9-dev',
                     'libxml2-dev',
                     'libz3-dev',
                     'pkg-config',
                     'tzdata',
                     'zlib1g-dev',
                 ];
                 break;
            default:
                dependencies = [];
                core.info(`Unknown platform '${swiftPlatform}' for dependency installation. Not installing anything...`);
                break;
        }
        if (dependencies.length > 0) {
            await core.group('Install dependencies', async () => {
                await runCmd('sudo', 'apt-get', '-q', 'update');
                await runCmd('sudo', 'apt-get', '-q', 'install', '-y', ...dependencies);
            });
        }
    } else {
        core.info('Skipping installation of dependencies...');
    }

    const versionIdentifier = `${swiftBranch}-${swiftVersion}-${swiftPlatform}`;
    const mangledName = `swift.${versionIdentifier}`;
    const cachedVersion = tools.find(mangledName, '1.0.0');
    const swiftInstallBase = path.join('/opt/swift', versionIdentifier);
    if (cachedVersion) {
        core.info('Using cached version!');
        await io.cp(cachedVersion, swiftInstallBase, { recursive: true });
    } else {
        await install(swiftInstallBase, swiftBranch, swiftVersion, swiftPlatform, skipGPGCheck);
        await tools.cacheDir(swiftInstallBase, mangledName, '1.0.0');
    }

    if (swiftRelease) {
        await core.group('Validating installation', async () => {
            const version = await runCmd(path.join(swiftInstallBase, '/usr/bin/swift'), '--version');
            if (!version.includes(swiftRelease))
                throw new Error(`Swift installation of version '${swiftRelease}' seems to have failed. 'swift --version' output: ${version}`);
        });
    }

    core.addPath(path.join(swiftInstallBase, '/usr/bin'));
    core.setOutput('install-path', swiftInstallBase);
    core.setOutput('full-version', swiftVersion);
}

try {
    main().catch(error => core.setFailed(error.message));
} catch (error: any) {
    core.setFailed(error.message);
}
