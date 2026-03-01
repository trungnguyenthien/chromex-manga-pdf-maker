#!/bin/bash

# Script to create placeholder icons for the Chrome extension
# Requires ImageMagick to be installed

cd "$(dirname "$0")"

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "ImageMagick is not installed. Please install it first:"
    echo "  macOS: brew install imagemagick"
    echo "  Ubuntu: sudo apt-get install imagemagick"
    exit 1
fi

# Create icons directory if it doesn't exist
mkdir -p icons

# Generate icons with different sizes
for size in 16 48 128; do
    convert -size ${size}x${size} xc:none \
        -fill "#4CAF50" \
        -draw "roundrectangle 0,0 ${size},${size} 4,4" \
        -fill white \
        -font Arial-Bold \
        -pointsize $((size/3)) \
        -gravity center \
        -annotate +0+0 "PDF" \
        icons/icon${size}.png
    echo "Created icon${size}.png"
done

echo "All icons created successfully!"
