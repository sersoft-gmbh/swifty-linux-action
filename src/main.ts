import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tools from '@actions/tool-cache';
import * as fs from "fs";
import * as util from "util";
import * as path from "path";

async function cmd(cmd: string, args?: string[], failOnStdErr: boolean = true): Promise<string> {
    let stdOut = '';
    await exec.exec(cmd, args, {
        failOnStdErr: failOnStdErr,
        listeners: {
            stdline: (data: string) => stdOut += data
        }
    });
    return stdOut;
}

async function copyRecursive(sourcePath: string, targetPath: string) {
    if ((await util.promisify(fs.lstat)(sourcePath)).isDirectory()) {
        if (!await util.promisify(fs.exists)(targetPath)) {
            await util.promisify(fs.mkdir)(targetPath, { recursive: true });
        }

        const files = await util.promisify(fs.readdir)(sourcePath);
        await Promise.all(files.map((file) => {
            return copyRecursive(path.join(sourcePath, file), path.join(targetPath, file));
        }));
    } else {
        await util.promisify(fs.copyFile)(sourcePath, targetPath);
    }
}

async function install(installBase: string, branchName: string, versionTag: string, platform: string) {
    const tempPath = await core.group('Setup paths', async () => {
        if (!await util.promisify(fs.exists)(installBase)) {
            await util.promisify(fs.mkdir)(installBase, { recursive: true });
        }
        return await util.promisify(fs.mkdtemp)('SwiftyActions');
    });

    const swiftURL = `https://swift.org/builds/${branchName}/${platform.split('.').join('')}/${versionTag}/${versionTag}-${platform}.tar.gz`;
    const swiftSigURL = `${swiftURL}.sig`;
    const allKeysURL = 'https://swift.org/keys/all-keys.asc';

    core.debug(`Downloading Swift from ${swiftURL}`);
    core.debug(`Downloading Swift signature from ${swiftSigURL}`);
    core.debug(`Downloading all keys from ${allKeysURL}`);

    const swiftPkg = path.join(tempPath, "swift.tar.gz");
    const swiftSig = path.join(tempPath, "swift.tar.gz.sig");
    const allKeysFile = path.join(tempPath, "all-keys.asc");
    await core.group('Downloading files', async () => {
        await Promise.all([
            tools.downloadTool(swiftURL, swiftPkg),
            tools.downloadTool(swiftSigURL, swiftSig),
            tools.downloadTool(allKeysURL, allKeysFile),
        ]);
    });

    await core.group('Verifying files', async () => {
        await cmd('gpg', ['--import', allKeysFile], false);
        await cmd('gpg', ['--verify', '--quiet', swiftSig, swiftPkg], false);
    });

    await core.group('Unpacking files', async () => {
        await tools.extractTar(swiftPkg, installBase, '-xz --strip-components=1');
        // We need the -R option and want to simply add r (not knowing what the other permissions are), so we use the command line here.
        await cmd('chmod', ['-R', 'o+r', path.join(installBase, '/usr/lib/swift')]);
    });

    await core.group('Cleaning up', async () => {
        await Promise.all([
            util.promisify(fs.unlink)(swiftPkg),
            util.promisify(fs.unlink)(swiftSig),
            util.promisify(fs.unlink)(allKeysFile),
        ]);
    });
}

async function main() {
    switch (process.platform) {
        case "linux": break;
        default: throw new Error("This action can only install Swift on linux!");
    }

    core.startGroup('Validate input');
    const swiftRelease = core.getInput('release-version');

    let swiftBranch: string, swiftVersion: string;
    if (!swiftRelease) {
        core.info("`release-version` was not set. Requiring `branch-name` and `version-tag` parameters!");
        swiftBranch = core.getInput('branch-name', { required: true });
        swiftVersion = core.getInput('version-tag', { required: true });
    } else {
        swiftBranch = `swift-${swiftRelease}-release`;
        swiftVersion = `swift-${swiftRelease}-RELEASE`;
    }

    const swiftPlatform = core.getInput('platform');
    const swiftInstallBase = core.getInput('install-base');
    const skipApt = core.getInput('skip-apt') == 'true';
    core.endGroup();

    if (!skipApt) {
        await core.group('Install dependencies', async () => {
            await cmd('sudo', ['apt-get', '-q', 'update']);
            await cmd('sudo', [
                'apt-get', '-q', 'install', '-y',
                'libatomic1',
                'libbsd0',
                'libcurl4',
                'libxml2',
                'libedit2',
                'libsqlite3-0',
                'libc6-dev',
                'binutils',
                'libgcc-5-dev',
                'libstdc++-5-dev',
                'libpython2.7',
                'tzdata',
                'git',
                'pkg-config',
                'curl',
            ]);
        });
    } else {
        core.info("Skipping installation of dependencies...");
    }

    const mangledName = `swift.${swiftBranch}-${swiftVersion}-${swiftPlatform}`;
    const cachedVersion = tools.find(mangledName, '1.0.0');
    if (cachedVersion) {
        core.info("Using cached version!");
        await copyRecursive(cachedVersion, swiftInstallBase);
    } else {
        await install(swiftInstallBase, swiftBranch, swiftVersion, swiftPlatform);
        await tools.cacheDir(swiftInstallBase, mangledName, '1.0.0');
    }

    if (swiftRelease) {
        await core.group('Validating installation', async () => {
            const version = await cmd(path.join(swiftInstallBase, '/usr/bin/swift'), ['--version']);
            if (!version.includes(swiftRelease)) {
                core.setFailed(`Swift installation of version '${swiftRelease}' seems to have failed. 'swift --version' output: ${version}`);
            }
        });
    }

    core.addPath(path.join(swiftInstallBase, '/usr/bin'));
}

try {
    main().catch((error) => {
        core.setFailed(error.message);
    });
} catch (error) {
    core.setFailed(error.message);
}

