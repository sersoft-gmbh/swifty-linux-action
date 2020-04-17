"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const tools = __importStar(require("@actions/tool-cache"));
const io = __importStar(require("@actions/io"));
const fs = __importStar(require("fs"));
const util = __importStar(require("util"));
const path = __importStar(require("path"));
async function cmd(cmd, args, failOnStdErr = true) {
    let stdOut = '';
    await exec.exec(cmd, args, {
        failOnStdErr: failOnStdErr,
        listeners: {
            stdline: (data) => stdOut += data
        }
    });
    return stdOut;
}
async function install(installBase, branchName, versionTag, platform) {
    const tempPath = await core.group('Setup paths', async () => {
        await io.mkdirP(installBase);
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
        await tools.extractTar(swiftPkg, installBase);
        // We need to pass 'strip-components', so we cannot use 'tools.extractTar'
        // if (await util.promisify(fs.realpath)(installBase) == '/') {
        //     await cmd('tar', ['x', '--strip-components=1', '-C', installBase, '-f', swiftPkg]);
        // } else {
        //     await cmd('tar', ['x', '--strip-components=1', '-C', installBase, '-f', swiftPkg]);
        // }
        // We need the -R option and want to simply add r (not knowing what the other permissions are), so we use the command line here.
        await cmd('chmod', ['-R', 'o+r', path.join(installBase, '/usr/lib/swift')]);
    });
    await core.group('Cleaning up', async () => {
        await io.rmRF(tempPath);
    });
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
    }
    else {
        core.info("Skipping installation of dependencies...");
    }
    const mangledName = `swift.${swiftBranch}-${swiftVersion}-${swiftPlatform}`;
    const cachedVersion = tools.find(mangledName, '1.0.0');
    if (cachedVersion) {
        core.info("Using cached version!");
        await io.cp(cachedVersion, swiftInstallBase, { recursive: true });
    }
    else {
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
}
catch (error) {
    core.setFailed(error.message);
}
