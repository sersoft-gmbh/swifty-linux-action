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
const tools = __importStar(require("@actions/tool-cache"));
const fs = __importStar(require("fs"));
const util = __importStar(require("util"));
const path = __importStar(require("path"));
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
async function copyRecursive(sourcePath, targetPath) {
    if ((await util.promisify(fs.lstat)(sourcePath)).isDirectory()) {
        if (!await util.promisify(fs.exists)(targetPath)) {
            await util.promisify(fs.mkdir)(targetPath, { recursive: true });
        }
        const files = await util.promisify(fs.readdir)(sourcePath);
        await Promise.all(files.map((file) => {
            return copyRecursive(path.join(sourcePath, file), path.join(targetPath, file));
        }));
    }
    else {
        await util.promisify(fs.copyFile)(sourcePath, targetPath);
    }
}
async function install(installBase, swiftURL) {
    const tempPath = await core.group('Setup paths', async () => {
        if (!await util.promisify(fs.exists)(installBase)) {
            await util.promisify(fs.mkdir)(installBase, { recursive: true });
        }
        return await util.promisify(fs.mkdtemp)('SwiftyActions');
    });
    const swiftSigURL = `${swiftURL}.sig`;
    const allKeysURL = 'https://swift.org/keys/all-keys.asc';
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
        await cmd('gpg', ['--import', allKeysFile]);
        await cmd('gpg', ['--verify', '--quiet', swiftSig, swiftPkg]);
    });
    await core.group('Unpacking files', async () => {
        await tools.extractTar(swiftPkg, installBase, 'x --strip-components=1');
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
        await copyRecursive(cachedVersion, swiftInstallBase);
    }
    else {
        const swiftURL = `https://swift.org/builds/${swiftBranch}/${swiftPlatform.split(".").join()}/${swiftVersion}/${swiftVersion}-${swiftPlatform}.tar.gz`;
        await install(swiftInstallBase, swiftURL);
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
