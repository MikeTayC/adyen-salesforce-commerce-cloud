#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${1:-./src/cartridges}"
BUILD_ROOT="${2:-./cartridges}"

found=0

while IFS= read -r -d '' css_file; do
    found=1

    relative_path="${css_file#"$BUILD_ROOT/"}"
    cartridge_name="${relative_path%%/*}"

    file_name="$(basename "$css_file" .css)"

    scss_dir="$BUILD_ROOT/$cartridge_name/cartridge/client/default/scss"
    scss_file="$scss_dir/$file_name.scss"

    mkdir -p "$scss_dir"

    if [[ -e "$scss_file" ]]; then
        echo "ERROR: Destination already exists: $scss_file" >&2
        exit 1
    fi

    mv "$css_file" "$scss_file"

    echo "Moved:"
    echo "$css_file → $scss_file"
done < <(
    find "$BUILD_ROOT" \
        -type f \
        -name '*.css' \
        -path '*/cartridge/static/default/css/*' \
        -print0
)

if [[ "$found" -eq 0 ]]; then
    echo "No CSS files found under $BUILD_ROOT/*/cartridge/static/default/css/."
fi

# Remove css directories only when nothing remains in them.
find "$BUILD_ROOT" \
    -type d \
    -path '*/cartridge/static/default/css' \
    -empty \
    -delete

# Copy the client-side Adyen MobX store into the built cartridge unchanged.
store_source="$SOURCE_ROOT/app_adyen_SFRA/cartridge/config/store.js"
store_dest="$BUILD_ROOT/app_adyen_SFRA/cartridge/config/store.js"

if [[ ! -f "$store_source" ]]; then
    echo "ERROR: store.js source not found: $store_source" >&2
    exit 1
fi


echo "Workaround: copying store.js to avoid mobx babel transpilation"
mkdir -p "$(dirname "$store_dest")"
cp "$store_source" "$store_dest"

echo "$store_source → $store_dest"
