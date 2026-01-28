#!/bin/bash
set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: bun run bump <version>"
  echo "Example: bun run bump 0.1.5"
  exit 1
fi

for f in packages/*/package.json; do
  perl -i -pe "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$f"
  echo "Updated $f to $VERSION"
done
