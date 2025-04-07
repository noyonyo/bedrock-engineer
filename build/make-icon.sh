#!/bin/bash

# Create app icons for Electron

#
# Electron用にアプリアイコンを一括作成
# https://blog.katsubemakito.net/nodejs/electron/app-icon
#
# How to execute
#   $ ./makeIcon.sh icon.png
#

#--------------------------------#
# Constants
#--------------------------------#
#-- Source image (512x512px) --#
readonly ORG_FILE=$1;

#-- Destination for Windows icons --#
readonly ICON_DIR_WIN='./'

#-- macOS icons --#
readonly ICONSET_DIR='icon.iconset'
readonly ICON_DIR_MAC='./'

#--------------------------------#
# For macOS
#--------------------------------#
mkdir -p $ICONSET_DIR

#-- Resize and copy the source image --#
convert -resize 16x16!    $ORG_FILE  $ICONSET_DIR/icon_16x16.png
convert -resize 32x32!    $ORG_FILE  $ICONSET_DIR/icon_16x16@2x.png
convert -resize 32x32!    $ORG_FILE  $ICONSET_DIR/icon_32x32.png
convert -resize 64x64!    $ORG_FILE  $ICONSET_DIR/icon_32x32@2x.png
convert -resize 128x128!  $ORG_FILE  $ICONSET_DIR/icon_128x128.png
convert -resize 256x256!  $ORG_FILE  $ICONSET_DIR/icon_128x128@2x.png
convert -resize 256x256!  $ORG_FILE  $ICONSET_DIR/icon_256x256.png
convert -resize 512x512!  $ORG_FILE  $ICONSET_DIR/icon_256x256@2x.png
convert -resize 512x512!  $ORG_FILE  $ICONSET_DIR/icon_512x512.png

#-- Convert to icns format file --#
iconutil -c icns $ICONSET_DIR -o $ICON_DIR_MAC/icon.icns

#---------------------------------------
# For Windows
#---------------------------------------
convert $ORG_FILE -define icon:auto-resize $ICON_DIR_WIN/icon.ico
