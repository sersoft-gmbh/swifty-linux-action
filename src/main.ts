import * as core from '@actions/core';
import exec from '@actions/exec';
import * as fs from "fs";
import * as https from "https";
import * as util from "util";
import tar from 'tar';
// @ts-ignore
import GPG from 'gpg';

async function cmd(cmd: string, args?: string[]): Promise<string> {
    let stdOut = '';
    await exec.exec(cmd, args, {
        failOnStdErr: true,
        listeners: {
            stdline: data => stdOut += data
        }
    });
    return stdOut;
}

async function downloadFile(name: string, url: string): Promise<string> {
    async function _download(dest: string, url: string): Promise<string> {
        return await new Promise((resolve, reject) => {
            https.get(url, response => {
                if ([301, 302].indexOf(response.statusCode ? response.statusCode : 0) !== -1 && response.headers.location) {
                    _download(dest, response.headers.location).then(resolve).catch(reject);
                }
                const file = fs.createWriteStream(dest);
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(dest);
                });
                file.on('error', reject);
            }).on('error', reject);
        });
    }
    const dest = await util.promisify(fs.mkdtemp)('SwiftyActions') + `/${name}`;
    return await _download(dest, url);
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
    const swiftURL = `https://swift.org/builds/${swiftBranch}/${swiftPlatform.split(".").join()}/${swiftVersion}/${swiftVersion}-${swiftPlatform}.tar.gz`;
    const swiftSigURL = `${swiftURL}.sig`;
    const allKeysURL = 'https://swift.org/keys/all-keys.asc';

    const skipApt = core.getInput('skip-apt') == 'true';
    core.endGroup()

    await core.group('Check install base', async () => {
        if (!await util.promisify(fs.exists)(swiftInstallBase)) {
            await util.promisify(fs.mkdir)(swiftInstallBase, { recursive: true });
        }
    });

    if (!skipApt) {
        await core.group('Install dependencies', async () => {
            await cmd('apt-get', ['-q', 'update']);
            await cmd('apt-get', [
                '-q', 'install', '-y',
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
        core.info("Skipping installation of dependencies...")
    }

    let swiftPkg: string, swiftSig: string, allKeysFile: string;
    await core.group('Downloading files', async () => {
        swiftPkg = await downloadFile('swift.tar.gz', swiftURL);
        swiftSig = await downloadFile('swift.tar.gz.sig', swiftSigURL);
        allKeysFile = await downloadFile('all-keys.asc', allKeysURL);
    });

    await core.group('Verifying files', async () => {
        await new Promise((resolve, reject) => {
            GPG.importKey(allKeysFile, (error?: Error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
        await new Promise((resolve, reject) => {
            GPG.call('', ['--verify', '--quiet', swiftSig, swiftPkg], (error?: Error) => {
               if (error) {
                   reject(error);
               } else {
                   resolve();
               }
            });
        });
    });

    await core.group('Unpacking files', async () => {
         await tar.x({ f: swiftPkg, strip: 1, cwd: swiftInstallBase });
         // We need the -R option and want to simply add r (not knowing what the other permissions are), so we use the command line here.
         await cmd('chmod', ['-R', 'o+r', `${swiftInstallBase}/usr/lib/swift`]);
    });

    await core.group('Cleaning up', async () => {
        await util.promisify(fs.unlink)(swiftPkg);
        await util.promisify(fs.unlink)(swiftSig);
        await util.promisify(fs.unlink)(allKeysFile);
    });

    if (swiftRelease) {
        await core.group('Validating installation', async () => {
            const version = await cmd(`${swiftInstallBase}/usr/bin/swift`, ['--version']);
            if (!version.includes(swiftRelease)) {
                core.setFailed(`Swift installation of version '${swiftRelease}' seems to have failed. 'swift --version' output: ${version}`);
            }
        });
    }

    core.addPath(`${swiftInstallBase}/usr/bin`)
}

try {
    main().catch(core.setFailed);
} catch (error) {
    core.setFailed(error.message);
}

