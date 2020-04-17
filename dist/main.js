"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const exec_1 = __importDefault(require("@actions/exec"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const util = __importStar(require("util"));
const tar_1 = __importDefault(require("tar"));
// @ts-ignore
const gpg_1 = __importDefault(require("gpg"));
async function cmd(cmd, args) {
    let stdOut = '';
    await exec_1.default.exec(cmd, args, {
        failOnStdErr: true,
        listeners: {
            stdline: data => stdOut += data
        }
    });
    return stdOut;
}
async function downloadFile(name, url) {
    async function _download(dest, url) {
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
    let swiftBranch, swiftVersion;
    if (!swiftRelease) {
        core.info("`release-version` was not set. Requiring `branch-name` and `version-tag` parameters!");
        swiftBranch = core.getInput('branch-name', { required: true });
        swiftVersion = core.getInput('version-tag', { required: true });
    }
    else {
        swiftBranch = `swift-${swiftRelease}-release`;
        swiftVersion = `swift-${swiftRelease}-RELEASE`;
    }
    const swiftPlatform = core.getInput('platform');
    const swiftInstallBase = core.getInput('install-base');
    const swiftURL = `https://swift.org/builds/${swiftBranch}/${swiftPlatform.split(".").join()}/${swiftVersion}/${swiftVersion}-${swiftPlatform}.tar.gz`;
    const swiftSigURL = `${swiftURL}.sig`;
    const allKeysURL = 'https://swift.org/keys/all-keys.asc';
    const skipApt = core.getInput('skip-apt') == 'true';
    core.endGroup();
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
    }
    else {
        core.info("Skipping installation of dependencies...");
    }
    let swiftPkg, swiftSig, allKeysFile;
    await core.group('Downloading files', async () => {
        swiftPkg = await downloadFile('swift.tar.gz', swiftURL);
        swiftSig = await downloadFile('swift.tar.gz.sig', swiftSigURL);
        allKeysFile = await downloadFile('all-keys.asc', allKeysURL);
    });
    await core.group('Verifying files', async () => {
        await new Promise((resolve, reject) => {
            gpg_1.default.importKey(allKeysFile, (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
        await new Promise((resolve, reject) => {
            gpg_1.default.call('', ['--verify', '--quiet', swiftSig, swiftPkg], (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    });
    await core.group('Unpacking files', async () => {
        await tar_1.default.x({ f: swiftPkg, strip: 1, cwd: swiftInstallBase });
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
    core.addPath(`${swiftInstallBase}/usr/bin`);
}
try {
    main().catch(core.setFailed);
}
catch (error) {
    core.setFailed(error.message);
}
