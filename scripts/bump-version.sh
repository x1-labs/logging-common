#!/bin/bash
set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: bun run bump <version>"
  echo "Example: bun run bump 0.1.5"
  exit 1
fi

# Update version in all packages
for f in packages/*/package.json; do
  perl -i -pe "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$f"
  echo "Updated $f to $VERSION"
done

# Update @x1-labs/logging dependency in nested packages
for f in packages/logging-nestjs/package.json packages/logging-express/package.json; do
  perl -i -pe "s/\"\\@x1-labs\\/logging\": \"\\^[^\"]*\"/\"\\@x1-labs\\/logging\": \"^$VERSION\"/" "$f"
  echo "Updated @x1-labs/logging dependency in $f to ^$VERSION"
done

# Build all packages
echo "Building all packages..."
bun run build
