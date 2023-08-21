# Swifty Linux Action

[![Tests](https://github.com/sersoft-gmbh/swifty-linux-action/actions/workflows/tests.yml/badge.svg)](https://github.com/sersoft-gmbh/swifty-linux-action/actions/workflows/tests.yml)

This action sets up a Swift environment on Linux.

Note that Linux is currently the only system supported by this action. Running it on other platforms will fail.

## Inputs

### `release-version`

The (released) Swift version (e.g. `5.6`) to install.<br/>
If `github-token` is also set, it will automatically resolve to the latest matching version.<br/>
*Note:* If given, `branch-name` and `version-tag` are ignored.

### `branch-name`

The branch of the Swift version to install (e.g. `swift-5.6.1-release`).<br/>
Required if `release-version` is not set!

### `version-tag`

The version tag of the Swift version to install (e.g. `swift-5.6.1-RELEASE`).<br/>
Required if `release-version` is not set!

### `platform`

The platform for which to install the Swift version (e.g. `ubuntu20.04`). Note that the github-actions notations with a dash (e.g. `ubuntu-20.04`) is also valid.<br/>
If not given, the action tries to determine the system it currently runs on. Note that this might fail if Swift is not available on this platform, or it's not yet supported by this action!.

### `skip-dependencies`

Whether the installation of dependencies (currently via `apt`) should be skipped.<br/>
Default: `false`

### `github-token`

The token to use for searching for the latest matching release. Can be set to `${{secrets.GITHUB_TOKEN}}`.<br/>
Default: `${{ github.token }}`

## Outputs

### `install-path`

The path where Swift was installed.<br/>
Note that this can usually be ignored, since swifty-linux-action adds the `${{install-path}}/usr/bin` to the `PATH` environment variable.

### `full-version`

The full version of Swift that was installed (e.g. `swift-5.6.1-RELEASE`).<br/>
This can be used to narrow down for example caches across builds.


## Example Usage

In general, the `release-version` input parameter should be used to install a final release of Swift.<br/>
To for example install Swift 5.6.1, use the following snippet:
```yaml
uses: sersoft-gmbh/swifty-linux-action@v1
with:
    release-version: 5.6.1
```

If you automatically want to install the latest matching version, also provide the `github-token` input.
This will search for the latest matching release using the following rules:
- `'5'` -> Finds the latest `swift-5.x.y` release.
- `'5.6'` -> Finds the latest `swift-5.6.x` release.

To for example install the latest Swift 5.4.x release, use the following snippet:
```yaml
uses: sersoft-gmbh/swifty-linux-action@v2
with:
    release-version: '5.6'
    github-token: ${{secrets.GITHUB_TOKEN}}
```

However, swifty-linux-action also supports installing other snapshots using the `branch-name` and `version-tag` input parameters.<br/>
So, to for example install the Swift 5.7 development snapshot built on 13th of June 2022, use the following snippet:

```yaml
uses: sersoft-gmbh/swifty-linux-action@v2
with:
    branch-name: swift-5.7-branch
    version-tag: swift-5.7-DEVELOPMENT-SNAPSHOT-2022-06-13-a
```
