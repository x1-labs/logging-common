#!/bin/bash
set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: bun run bump <version>"
  echo "Example: bun run bump 0.1.5"
  exit 1
fi

# Reject anything that is not a plain semver version. Without this, a typo
# like `bun run bump 0.13` is written verbatim into eight files and only
# noticed at publish time.
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Error: '$VERSION' is not a version number (expected e.g. 0.1.31)" >&2
  exit 1
fi

# Update version in all packages
for f in packages/*/package.json; do
  perl -i -pe "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$f"
  echo "Updated $f to $VERSION"
done

# Update @x1-labs/logging dependency in nested packages
for f in packages/logging-*/package.json; do
  perl -i -pe "s/\"\\@x1-labs\\/logging\": \"\\^[^\"]*\"/\"\\@x1-labs\\/logging\": \"^$VERSION\"/" "$f"
  echo "Updated @x1-labs/logging dependency in $f to ^$VERSION"
done

# Update the workspace block in bun.lock to match the manifests.
#
# `bun install` will not do this for us. Bun only rewrites bun.lock when
# resolution changes, and @x1-labs/logging always resolves to
# workspace:packages/logging whatever range is recorded -- so these fields
# drift silently, as they did for roughly twenty releases. Regenerating the
# file instead (rm bun.lock && bun install) fixes them but simultaneously
# re-resolves every in-range external dependency, burying the release in an
# unrelated 150-line diff.
#
# Edits are confined to the text above `"packages": {`, so no resolved
# dependency entry can be touched.
VERSION="$VERSION" perl -0777 -i -pe '
  my $cut = index($_, "  \"packages\": {");
  $cut = length($_) if $cut < 0;
  my ($head, $tail) = (substr($_, 0, $cut), substr($_, $cut));
  $head =~ s/"version": "[^"]*"/"version": "$ENV{VERSION}"/g;
  $head =~ s{"\@x1-labs/logging": "\^[^"]*"}{"\@x1-labs/logging": "^$ENV{VERSION}"}g;
  $_ = $head . $tail;
' bun.lock
echo "Updated bun.lock workspace metadata to $VERSION"

# Prove the lockfile and the manifests agree. This is what CI runs, so a
# failure here is a release that would have failed CI anyway.
echo "Verifying lockfile..."
bun install --frozen-lockfile >/dev/null

# Build all packages
echo "Building all packages..."
bun run build
