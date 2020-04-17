# SwiftyActions

![Integration Tests](https://github.com/sersoft-gmbh/SwiftyActions/workflows/Integration%20Tests/badge.svg)

This action sets up a Swift environment on linux.

## Inputs

### `release-version`

The (released) Swift version (e.g. `5.2.1`) to install. If given, `branch-name` and `version-tag` are ignored.

### `branch-name`

The branch of the Swift version to install (e.g. `swift-5.2.1-release`).
Required if `release-version` is not set!

### `version-tag`

The version tag of the Swift version to install (e.g. `swift-5.2.1-RELEASE`).
Required if `release-version` is not set!

### `platform`

The platform for which to install the Swift version (e.g. ubuntu18.04).
Default: `ubuntu18.04`.

### `skip-apt`

Whether the installation of dependencies (via apt) should be skipped.
Default: `false`

## Outputs

### `install-path`

The path where Swift was installed.

## Example Usage

```
uses: sersoft-gmbh/SwiftyActions@v1
with:
    release-version: 5.2.1
```
