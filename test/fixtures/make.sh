#!/bin/sh
# One-second silent MP3s with real tags in each ID3 version. Needs ffmpeg.
cd "$(dirname "$0")"
gen() { ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=22050:cl=mono -t 1 -c:a libmp3lame -b:a 32k "$@"; }
gen -id3v2_version 3 -metadata title="Track One" -metadata artist="Some Band" -metadata album="Some Album" -metadata date=2001 -metadata track=1 v23.mp3
gen -id3v2_version 4 -metadata title="Track Two" -metadata artist="Some Band" -metadata album="some album " -metadata date=2001 -metadata track=2 -metadata comment="ripped by x" v24.mp3
gen -id3v2_version 3 -metadata title="No Number" -metadata artist="Other Band" -metadata album="Some Album" nonum.mp3
gen -write_id3v1 1 -id3v2_version 3 -metadata title="Has V1" -metadata artist="Some Band" -metadata album="Some Album" v1.mp3
gen -id3v2_version 0 raw.mp3
ffmpeg -y -loglevel error -f lavfi -i color=c=red:s=800x500 -frames:v 1 cover.png
