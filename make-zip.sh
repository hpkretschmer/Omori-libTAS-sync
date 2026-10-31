#!/bin/sh
# Build the OneLoader mod zip from the last commit
cd "$(dirname "$0")"
git archive --format=zip --prefix=libtassync/ -o libtassync.zip HEAD mod.json libTAS_Sync.js
echo "Wrote libtassync.zip"
