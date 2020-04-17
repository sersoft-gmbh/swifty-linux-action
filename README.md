# SwiftyActions

![Integration Tests](https://github.com/sersoft-gmbh/SwiftyActions/workflows/Integration%20Tests/badge.svg)

This action sets up a Swift environment on linux.

Note that Linux is currently the only system supported by this action. Running it on other platforms will fail.

## Inputs

### `release-version`

The (released) Swift version (e.g. `5.2.2`) to install.<br/>
*Note:* If given, `branch-name` and `version-tag` are ignored.

### `branch-name`

The branch of the Swift version to install (e.g. `swift-5.2.2-release`).<br/>
Required if `release-version` is not set!

### `version-tag`

The version tag of the Swift version to install (e.g. `swift-5.2.2-RELEASE`).<br/>
Required if `release-version` is not set!

### `platform`

The platform for which to install the Swift version (e.g. `ubuntu18.04`).<br/>
Default: `ubuntu18.04`.

### `skip-apt`

Whether the installation of dependencies (via apt) should be skipped.<br/>
Default: `false`

## Outputs

### `install-path`

The path where Swift was installed.<br/>
Note that this can usually be ignored, since SwiftyActions adds the `${{install-path}}/usr/bin` to the `PATH` environment variable.

## Example Usage

In general, the `release-version` input parameter should be used to install a final release of Swift. 
To e.g. install Swift 5.2.2, use the following snippet:
```yaml
uses: sersoft-gmbh/SwiftyActions@v1
with:
    release-version: 5.2.2
```

However, SwiftyActions also supports installing other snapshots using the `branch-name` and `version-tag` input parameters.
So, to e.g. install a the Swift 5.2 development snapshot built on 14th of April 2020, use the following snippet:

```yaml
uses: sersoft-gmbh/SwiftyActions@v1
with:
    branch-name: swift-5.2-branch
    version-tag: swift-5.2-DEVELOPMENT-SNAPSHOT-2020-04-14-a
``` 

